/**
 * Decision module — E2E flow tests (in-memory)
 *
 * These tests drive the FULL lifecycle of a decision without touching
 * Supabase. All repos are in-memory fakes; charge generators are fake
 * stubs. No mocks — only real use-case instances wired together.
 *
 * Flows covered:
 *   A) Happy path       — RECEPTION → VOTING → RESOLVED → INVOICE generated
 *   B) Tiebreak         — RECEPTION → VOTING → tie → TIEBREAK_PENDING → manual resolve → ASSESSMENT generated
 *   C) Cancel           — RECEPTION → CANCELLED (audit log verified)
 *   D) Quote self-delete — resident deletes own quote during RECEPTION
 *   E) Vote idempotency  — second vote from same apartment is rejected
 */

import { describe, it, expect, beforeEach } from 'bun:test';

// ── Use Cases ─────────────────────────────────────────────────────────────────
import { CreateDecision } from '@/modules/decisions/application/use-cases/CreateDecision';
import { UploadQuote } from '@/modules/decisions/application/use-cases/UploadQuote';
import { DeleteQuote } from '@/modules/decisions/application/use-cases/DeleteQuote';
import { FinalizeDecision } from '@/modules/decisions/application/use-cases/FinalizeDecision';
import { CastVote } from '@/modules/decisions/application/use-cases/CastVote';
import { GetResults } from '@/modules/decisions/application/use-cases/GetResults';
import { GenerateCharge } from '@/modules/decisions/application/use-cases/GenerateCharge';
import { CancelDecision } from '@/modules/decisions/application/use-cases/CancelDecision';
import { ResolveTiebreak } from '@/modules/decisions/application/use-cases/ResolveTiebreak';

// ── Fakes ─────────────────────────────────────────────────────────────────────
import {
  InMemoryDecisionRepo,
  InMemoryQuoteRepo,
  InMemoryVoteRepo,
  InMemoryAuditRepo,
} from './fakes';

// ── Domain ────────────────────────────────────────────────────────────────────
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
  ChargeRequest,
  ChargeResult,
  InvoiceChargeGenerator,
  AssessmentChargeGenerator,
} from '@/modules/decisions/application/ports/ChargeGenerator';

// ── Charge stubs ──────────────────────────────────────────────────────────────

class FakeInvoiceGen implements InvoiceChargeGenerator {
  calls: ChargeRequest[] = [];
  async generate(req: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(req);
    return { type: 'INVOICE', id: 'inv-' + Date.now() };
  }
}
class FakeAssessmentGen implements AssessmentChargeGenerator {
  calls: ChargeRequest[] = [];
  async generate(req: ChargeRequest): Promise<ChargeResult> {
    this.calls.push(req);
    return { type: 'ASSESSMENT', id: 'asm-' + Date.now() };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const future = (ms: number) => new Date(Date.now() + ms);
const past   = (ms: number) => new Date(Date.now() - ms);

/** Bootstrap the full use-case graph sharing the same in-memory stores */
function buildContext() {
  const decisionRepo  = new InMemoryDecisionRepo();
  const quoteRepo     = new InMemoryQuoteRepo();
  const voteRepo      = new InMemoryVoteRepo();
  const auditRepo     = new InMemoryAuditRepo();
  const invoiceGen    = new FakeInvoiceGen();
  const assessmentGen = new FakeAssessmentGen();

  // total apartments supplier — used by GetResults; simulates 3 units in building
  const totalApartments = async (_buildingId: string) => 3;

  return {
    decisionRepo, quoteRepo, voteRepo, auditRepo,
    invoiceGen, assessmentGen,
    createDecision:    new CreateDecision(decisionRepo, auditRepo),
    uploadQuote:       new UploadQuote(decisionRepo, quoteRepo),
    deleteQuote:       new DeleteQuote(decisionRepo, quoteRepo, auditRepo),
    castVote:          new CastVote(decisionRepo, quoteRepo, voteRepo),
    finalizeDecision:  new FinalizeDecision(decisionRepo, quoteRepo, voteRepo, auditRepo),
    getResults:        new GetResults(decisionRepo, quoteRepo, voteRepo, totalApartments),
    generateCharge:    new GenerateCharge(decisionRepo, quoteRepo, auditRepo, invoiceGen, assessmentGen),
    cancelDecision:    new CancelDecision(decisionRepo, auditRepo),
    resolveTiebreak:   new ResolveTiebreak(decisionRepo, quoteRepo, auditRepo),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow A — Happy path: RECEPTION → VOTING → RESOLVED → INVOICE
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow A — happy path (clear winner → INVOICE)', () => {
  const ctx = buildContext();
  let decisionId: string;
  let q1Id: string, q2Id: string, q3Id: string;

  it('A1: creates a decision in RECEPTION', async () => {
    const d = await ctx.createDecision.execute({
      building_id: 'b1',
      actor_user_id: 'admin-1',
      title: 'Reparación del portón principal',
      reception_deadline: future(100),   // expires quickly for test
      voting_deadline: future(200),
    });

    decisionId = d.id;
    expect(d.status).toBe(DecisionStatus.RECEPTION);
    expect(d.current_round).toBe(1);

    const logs = await ctx.auditRepo.listForDecision(decisionId);
    expect(logs).toHaveLength(1);
    expect(logs[0].event).toBe(AuditEvent.CREATED);
  });

  it('A2: residents upload 3 quotes during RECEPTION', async () => {
    const q1 = await ctx.uploadQuote.execute({
      decision_id: decisionId,
      uploader_user_id: 'u1', uploader_unit_id: 'apt1',
      provider_name: 'Acme Portones', amount: 5000, file_url: '/q1.pdf',
    });
    const q2 = await ctx.uploadQuote.execute({
      decision_id: decisionId,
      uploader_user_id: 'u2', uploader_unit_id: 'apt2',
      provider_name: 'Portones SA', amount: 4500, file_url: '/q2.pdf',
    });
    const q3 = await ctx.uploadQuote.execute({
      decision_id: decisionId,
      uploader_user_id: 'u3', uploader_unit_id: 'apt3',
      provider_name: 'Herrero Local', amount: 6000, file_url: '/q3.pdf',
    });

    q1Id = q1.id; q2Id = q2.id; q3Id = q3.id;

    const stored = await ctx.quoteRepo.listForDecision(decisionId);
    expect(stored).toHaveLength(3);
  });

  it('A3: finalize after RECEPTION deadline → advances to VOTING', async () => {
    // Mutate the decision to simulate expired deadline
    const d = await ctx.decisionRepo.findById(decisionId);
    (d as any).props.reception_deadline = past(1000);
    (d as any).props.voting_deadline    = future(200);
    await ctx.decisionRepo.update(d!);

    const result = await ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' });
    expect(result.outcome).toBe('ADVANCED_TO_VOTING');

    const updated = await ctx.decisionRepo.findById(decisionId);
    expect(updated!.status).toBe(DecisionStatus.VOTING);
  });

  it('A4: 3 apartments cast votes — q2 wins (2 votes)', async () => {
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt1', quote_id: q2Id, voter_user_id: 'u1' });
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt2', quote_id: q2Id, voter_user_id: 'u2' });
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt3', quote_id: q1Id, voter_user_id: 'u3' });

    const votes = await ctx.voteRepo.listForDecision(decisionId, 1);
    expect(votes).toHaveLength(3);
  });

  it('A5: tally shows q2 as leader with highest votes (decision still in VOTING)', async () => {
    const tally = await ctx.getResults.execute(decisionId, 1);
    expect(tally.total_votes).toBe(3);
    expect(tally.participation_pct).toBe(100);
    // winner_quote_id is null until the decision reaches RESOLVED
    expect(tally.winner_quote_id).toBeNull();
    expect(tally.is_tied).toBe(false);
    // tallies sorted desc — first entry is the leader
    expect(tally.tallies[0].quote_id).toBe(q2Id);
    expect(tally.tallies[0].votes).toBe(2);
  });

  it('A6: finalize after VOTING deadline → RESOLVED with winner', async () => {
    const d = await ctx.decisionRepo.findById(decisionId);
    (d as any).props.voting_deadline = past(1000);
    await ctx.decisionRepo.update(d!);

    const result = await ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' });
    expect(result.outcome).toBe('RESOLVED');

    const resolved = await ctx.decisionRepo.findById(decisionId);
    expect(resolved!.status).toBe(DecisionStatus.RESOLVED);
    expect(resolved!.winner_quote_id).toBe(q2Id);

    const logs = await ctx.auditRepo.listForDecision(decisionId);
    const finalizeLog = logs.find(l => l.event === AuditEvent.FINALIZED);
    expect(finalizeLog).toBeDefined();
  });

  it('A7: admin generates INVOICE from winner quote', async () => {
    const result = await ctx.generateCharge.execute({
      decision_id: decisionId,
      type: 'INVOICE',
      actor_user_id: 'admin-1',
    });

    expect(result.resulting.type).toBe('INVOICE');
    expect(ctx.invoiceGen.calls).toHaveLength(1);
    expect(ctx.invoiceGen.calls[0].amount).toBe(4500); // q2 amount

    const d = await ctx.decisionRepo.findById(decisionId);
    expect(d!.resulting_type).toBe('INVOICE');
    expect(d!.resulting_id).toMatch(/^inv-/);

    const logs = await ctx.auditRepo.listForDecision(decisionId);
    expect(logs.find(l => l.event === AuditEvent.CHARGE_GENERATED)).toBeDefined();
  });

  it('A8: cannot generate charge twice (idempotency guard)', async () => {
    await expect(
      ctx.generateCharge.execute({ decision_id: decisionId, type: 'INVOICE', actor_user_id: 'admin-1' }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow B — Tiebreak: VOTING tie → TIEBREAK_PENDING → manual → ASSESSMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow B — tiebreak (manual resolution → ASSESSMENT)', () => {
  const ctx = buildContext();
  let decisionId: string;
  let q1Id: string, q2Id: string;

  it('B1: creates decision and two quotes', async () => {
    const d = await ctx.createDecision.execute({
      building_id: 'b1',
      actor_user_id: 'admin-1',
      title: 'Pintura fachada',
      reception_deadline: future(100),
      voting_deadline: future(200),
    });
    decisionId = d.id;

    const q1 = await ctx.uploadQuote.execute({
      decision_id: decisionId, uploader_user_id: 'u1',
      provider_name: 'PintaCorp', amount: 8000, file_url: '/p1.pdf',
    });
    const q2 = await ctx.uploadQuote.execute({
      decision_id: decisionId, uploader_user_id: 'u2',
      provider_name: 'Brocha Fina', amount: 8500, file_url: '/p2.pdf',
    });
    q1Id = q1.id; q2Id = q2.id;
  });

  it('B2: advances to VOTING', async () => {
    const d = await ctx.decisionRepo.findById(decisionId);
    (d as any).props.reception_deadline = past(1000);
    (d as any).props.voting_deadline = future(200);
    await ctx.decisionRepo.update(d!);

    const result = await ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' });
    expect(result.outcome).toBe('ADVANCED_TO_VOTING');
  });

  it('B3: round 1 is a tie (1 vote each) → opens round 2', async () => {
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt1', quote_id: q1Id, voter_user_id: 'u1' });
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt2', quote_id: q2Id, voter_user_id: 'u2' });

    const d = await ctx.decisionRepo.findById(decisionId);
    (d as any).props.voting_deadline = past(1000);
    await ctx.decisionRepo.update(d!);

    const result = await ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' });
    expect(result.outcome).toBe('TIEBREAK_OPENED');

    const updated = await ctx.decisionRepo.findById(decisionId);
    expect(updated!.current_round).toBe(2);
    expect(updated!.status).toBe(DecisionStatus.VOTING);
  });

  it('B4: round 2 is also a tie → TIEBREAK_PENDING (manual required)', async () => {
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt1', quote_id: q1Id, voter_user_id: 'u1' });
    await ctx.castVote.execute({ decision_id: decisionId, apartment_id: 'apt2', quote_id: q2Id, voter_user_id: 'u2' });

    // Reset deadline to expired
    const d = await ctx.decisionRepo.findById(decisionId);
    (d as any).props.voting_deadline = past(1000);
    await ctx.decisionRepo.update(d!);

    const result = await ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' });
    expect(result.outcome).toBe('TIEBREAK_PENDING_MANUAL');

    const updated = await ctx.decisionRepo.findById(decisionId);
    expect(updated!.status).toBe(DecisionStatus.TIEBREAK_PENDING);
  });

  it('B5: board manually resolves tiebreak picking q1', async () => {
    const result = await ctx.resolveTiebreak.execute({
      decision_id: decisionId,
      winner_quote_id: q1Id,
      actor_user_id: 'board-1',
    });

    expect(result.status).toBe(DecisionStatus.RESOLVED);
    expect(result.winner_quote_id).toBe(q1Id);

    const logs = await ctx.auditRepo.listForDecision(decisionId);
    expect(logs.find(l => l.event === AuditEvent.WINNER_SET_MANUAL)).toBeDefined();
  });

  it('B6: generates ASSESSMENT from winner quote', async () => {
    const result = await ctx.generateCharge.execute({
      decision_id: decisionId,
      type: 'ASSESSMENT',
      actor_user_id: 'admin-1',
    });

    expect(result.resulting.type).toBe('ASSESSMENT');
    expect(ctx.assessmentGen.calls).toHaveLength(1);
    expect(ctx.assessmentGen.calls[0].amount).toBe(8000); // q1 amount
    expect(ctx.assessmentGen.calls[0].building_id).toBe('b1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow C — Cancellation during RECEPTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow C — cancel during RECEPTION', () => {
  const ctx = buildContext();
  let decisionId: string;

  it('C1: creates decision and uploads a quote', async () => {
    const d = await ctx.createDecision.execute({
      building_id: 'b1', actor_user_id: 'admin-1',
      title: 'Reparación bomba de agua',
      reception_deadline: future(60_000),
      voting_deadline: future(120_000),
    });
    decisionId = d.id;
    await ctx.uploadQuote.execute({
      decision_id: decisionId, uploader_user_id: 'u1',
      provider_name: 'Plomer SA', amount: 2500, file_url: '/q.pdf',
    });
  });

  it('C2: board cancels the decision with a reason', async () => {
    const d = await ctx.cancelDecision.execute({
      decision_id: decisionId,
      actor_user_id: 'board-1',
      reason: 'El proveedor ya fue contratado directamente por urgencia.',
    });

    expect(d.status).toBe(DecisionStatus.CANCELLED);
    expect(d.cancel_reason).toBe('El proveedor ya fue contratado directamente por urgencia.');
    expect(d.cancelled_at).toBeInstanceOf(Date);
  });

  it('C3: audit log records CANCELLED event', async () => {
    const logs = await ctx.auditRepo.listForDecision(decisionId);
    const cancelLog = logs.find(l => l.event === AuditEvent.CANCELLED);
    expect(cancelLog).toBeDefined();
    expect(cancelLog!.actor_user_id).toBe('board-1');
  });

  it('C4: cannot upload a quote to a CANCELLED decision', async () => {
    await expect(
      ctx.uploadQuote.execute({
        decision_id: decisionId, uploader_user_id: 'u1',
        provider_name: 'Otro Plomero', amount: 2000, file_url: '/q2.pdf',
      }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow D — Resident self-deletes a quote during RECEPTION
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow D — resident self-deletes quote during RECEPTION', () => {
  const ctx = buildContext();
  let decisionId: string;
  let quoteId: string;

  it('D1: resident uploads quote', async () => {
    const d = await ctx.createDecision.execute({
      building_id: 'b1', actor_user_id: 'admin-1',
      title: 'Cámaras de seguridad',
      reception_deadline: future(60_000),
      voting_deadline: future(120_000),
    });
    decisionId = d.id;

    const q = await ctx.uploadQuote.execute({
      decision_id: decisionId, uploader_user_id: 'res-1', uploader_unit_id: 'apt5',
      provider_name: 'SecureCam', amount: 12000, file_url: '/cam.pdf',
    });
    quoteId = q.id;
  });

  it('D2: resident deletes their own quote', async () => {
    const q = await ctx.deleteQuote.execute({
      decision_id: decisionId,
      quote_id: quoteId,
      actor_user_id: 'res-1',
      actor_role: 'resident',
      reason: 'Me equivoqué de archivo',
    });

    expect(q.isDeleted).toBe(true);
    // domain hardcodes reason for resident self-deletes (not the caller's reason)
    expect(q.deletion_reason).toBe('self-deleted by uploader');
    expect(q.deleted_by).toBe('res-1');
  });

  it('D3: active quotes list excludes the deleted quote', async () => {
    const active = await ctx.quoteRepo.listForDecision(decisionId, false);
    expect(active).toHaveLength(0);
    const withDeleted = await ctx.quoteRepo.listForDecision(decisionId, true);
    expect(withDeleted).toHaveLength(1);
  });

  it('D4: finalize with no active quotes → throws', async () => {
    const d = await ctx.decisionRepo.findById(decisionId);
    (d as any).props.reception_deadline = past(1000);
    await ctx.decisionRepo.update(d!);

    await expect(
      ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' }),
    ).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow E — Vote idempotency (same apartment cannot vote twice in same round)
// ─────────────────────────────────────────────────────────────────────────────

describe('Flow E — vote idempotency', () => {
  const ctx = buildContext();
  let decisionId: string;
  let q1Id: string;

  it('E1: setup — decision in VOTING with one quote', async () => {
    const d = await ctx.createDecision.execute({
      building_id: 'b1', actor_user_id: 'admin-1',
      title: 'Impermeabilización terraza',
      reception_deadline: future(100),
      voting_deadline: future(200),
    });
    decisionId = d.id;

    const q = await ctx.uploadQuote.execute({
      decision_id: decisionId, uploader_user_id: 'u1',
      provider_name: 'Impermex', amount: 15000, file_url: '/imp.pdf',
    });
    q1Id = q.id;

    // Advance to VOTING
    const stored = await ctx.decisionRepo.findById(decisionId);
    (stored as any).props.reception_deadline = past(1000);
    (stored as any).props.voting_deadline = future(500);
    await ctx.decisionRepo.update(stored!);
    await ctx.finalizeDecision.execute({ decision_id: decisionId, actor_user_id: 'system' });
  });

  it('E2: apt1 votes successfully', async () => {
    const v = await ctx.castVote.execute({
      decision_id: decisionId, apartment_id: 'apt1',
      quote_id: q1Id, voter_user_id: 'u1',
    });
    expect(v.apartment_id).toBe('apt1');
  });

  it('E3: apt1 tries to vote again in the same round → rejected', async () => {
    await expect(
      ctx.castVote.execute({
        decision_id: decisionId, apartment_id: 'apt1',
        quote_id: q1Id, voter_user_id: 'u1',
      }),
    ).rejects.toThrow();
  });
});
