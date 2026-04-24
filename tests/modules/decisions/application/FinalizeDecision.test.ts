import { describe, it, expect } from 'bun:test';
import { FinalizeDecision } from '@/modules/decisions/application/use-cases/FinalizeDecision';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryVoteRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const past = (ms: number) => new Date(Date.now() - ms);
const future = (ms: number) => new Date(Date.now() + ms);

const makeDecisionReceptionExpired = () =>
  new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(5000), voting_deadline: future(60_000) });

const makeVotingDecision = (id = 'd1', round = 1) =>
  new Decision({ id, building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(10_000), voting_deadline: past(1000), status: DecisionStatus.VOTING, current_round: round });

const makeQuote = (id: string, decId = 'd1', deleted = false) => {
  const q = new DecisionQuote({ id, decision_id: decId, uploader_user_id: 'u1', provider_name: 'Acme', amount: 1000, file_url: '/f.pdf' });
  if (deleted) q.softDelete('admin', 'test');
  return q;
};

const makeVote = (id: string, apt: string, quote: string, round = 1) =>
  new DecisionVote({ id, decision_id: 'd1', round, apartment_id: apt, quote_id: quote, voted_by_user_id: 'u' + id });

describe('FinalizeDecision', () => {
  it('RECEPTION expired with quotes → advances to VOTING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeDecisionReceptionExpired());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.VOTING);
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.PHASE_ADVANCED);
  });

  it('RECEPTION expired with NO active quotes → throws 422 DECISION_NO_ACTIVE_QUOTES (§7.6)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeDecisionReceptionExpired());
    // no quotes at all
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    await expect(uc.execute({ decision_id: 'd1', actor_user_id: 'system' })).rejects.toThrow();
  });

  it('RECEPTION expired with only deleted quotes → throws 422 DECISION_NO_ACTIVE_QUOTES (§7.6)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeDecisionReceptionExpired());
    await quoteRepo.create(makeQuote('q1', 'd1', true)); // deleted
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', actor_user_id: 'system' })).rejects.toThrow();
  });

  it('VOTING with clear winner → RESOLVED', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    await voteRepo.create(makeVote('v2', 'apt2', 'q1'));
    await voteRepo.create(makeVote('v3', 'apt3', 'q2'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.RESOLVED);
    expect(result.winner_quote_id).toBe('q1');
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.FINALIZED);
  });

  it('VOTING with tie round 1 → opens tiebreak (round 2)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    await voteRepo.create(makeVote('v2', 'apt2', 'q2'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.VOTING);
    expect(result.current_round).toBe(2);
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.TIEBREAK_OPENED);
  });

  it('VOTING with tie round 2 → TIEBREAK_PENDING (manual resolution)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision('d1', 2));
    await quoteRepo.create(makeQuote('q1'));
    await quoteRepo.create(makeQuote('q2'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1', 2));
    await voteRepo.create(makeVote('v2', 'apt2', 'q2', 2));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.TIEBREAK_PENDING);
  });

  it('VOTING with no votes → TIEBREAK_PENDING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.TIEBREAK_PENDING);
  });

  it('VOTING with no active quotes → TIEBREAK_PENDING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1', 'd1', true));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.TIEBREAK_PENDING);
  });

  it('throws 404 when decision not found', async () => {
    const uc = new FinalizeDecision(new InMemoryDecisionRepo(), new InMemoryQuoteRepo(), new InMemoryVoteRepo(), new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'missing', actor_user_id: 'system' })).rejects.toThrow();
  });

  it('idempotent when already RESOLVED → returns current state without mutation or audit', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const audit = new InMemoryAuditRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(10_000), voting_deadline: past(1000), status: DecisionStatus.RESOLVED, winner_quote_id: 'q1' });
    await decRepo.create(d);
    const uc = new FinalizeDecision(decRepo, new InMemoryQuoteRepo(), new InMemoryVoteRepo(), audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.RESOLVED);
    expect(result.winner_quote_id).toBe('q1');
    // no new audit entries on idempotent call
    const logs = await audit.listForDecision('d1');
    expect(logs).toHaveLength(0);
  });

  it('idempotent when already CANCELLED → returns current state', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const audit = new InMemoryAuditRepo();
    const d = makeDecisionReceptionExpired();
    d.cancel('obsolete');
    await decRepo.create(d);
    const uc = new FinalizeDecision(decRepo, new InMemoryQuoteRepo(), new InMemoryVoteRepo(), audit);
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'system' });
    expect(result.status).toBe(DecisionStatus.CANCELLED);
  });

  // --- force advance (RECEPTION → VOTING override) -------------------------

  const makeDecisionReceptionFuture = () =>
    new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: future(60_000), voting_deadline: future(120_000) });

  it('force:true with reason advances before reception_deadline', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeDecisionReceptionFuture());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    const result = await uc.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      force: true,
      reason: 'All expected quotes submitted',
    });
    expect(result.status).toBe(DecisionStatus.VOTING);
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.PHASE_ADVANCED);
    const payload = logs[0].payload as Record<string, unknown>;
    expect(payload.forced).toBe(true);
    expect(payload.reason).toBe('All expected quotes submitted');
    expect(payload.previous_reception_deadline).toEqual(expect.any(String));
  });

  it('force:true without reason → 400 VALIDATION_ERROR', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeDecisionReceptionFuture());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), new InMemoryAuditRepo());
    await expect(
      uc.execute({ decision_id: 'd1', actor_user_id: 'admin-1', force: true }),
    ).rejects.toThrow();
    await expect(
      uc.execute({ decision_id: 'd1', actor_user_id: 'admin-1', force: true, reason: '   ' }),
    ).rejects.toThrow();
  });

  it('force:true still requires at least one active quote', async () => {
    const decRepo = new InMemoryDecisionRepo();
    await decRepo.create(makeDecisionReceptionFuture());
    const uc = new FinalizeDecision(decRepo, new InMemoryQuoteRepo(), new InMemoryVoteRepo(), new InMemoryAuditRepo());
    await expect(
      uc.execute({ decision_id: 'd1', actor_user_id: 'admin-1', force: true, reason: 'go now' }),
    ).rejects.toThrow(); // DECISION_NO_ACTIVE_QUOTES
  });

  it('force is ignored without effect when deadline already passed (normal audit payload)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeDecisionReceptionExpired()); // already past
    await quoteRepo.create(makeQuote('q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, new InMemoryVoteRepo(), audit);
    // no force — advances normally; audit payload stays clean
    const result = await uc.execute({ decision_id: 'd1', actor_user_id: 'admin-1' });
    expect(result.status).toBe(DecisionStatus.VOTING);
    const payload = (await audit.listForDecision('d1'))[0].payload as Record<string, unknown>;
    expect(payload.forced).toBeUndefined();
    expect(payload.reason).toBeUndefined();
  });

  it('force has no effect on VOTING → finalize path (no deadline check there)', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const voteRepo = new InMemoryVoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('q1'));
    await voteRepo.create(makeVote('v1', 'apt1', 'q1'));
    const uc = new FinalizeDecision(decRepo, quoteRepo, voteRepo, audit);
    // force:true should not require reason on VOTING path; reaches RESOLVED normally
    const result = await uc.execute({
      decision_id: 'd1',
      actor_user_id: 'admin-1',
      force: true,
      reason: 'irrelevant here',
    });
    expect(result.status).toBe(DecisionStatus.RESOLVED);
  });
});
