import { describe, it, expect } from 'bun:test';
import { DeleteQuote } from '@/modules/decisions/application/use-cases/DeleteQuote';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

const makeReceptionDecision = () =>
  new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: future(60_000), voting_deadline: future(120_000) });

const makeVotingDecision = () =>
  new Decision({ id: 'd2', building_id: 'b1', created_by: 'u1', title: 'Reparación portón 2', reception_deadline: past(5000), voting_deadline: future(60_000), status: DecisionStatus.VOTING });

const makeQuote = (decId: string, uploaderId: string) =>
  new DecisionQuote({ id: 'q1', decision_id: decId, uploader_user_id: uploaderId, provider_name: 'Acme SA', amount: 1000, file_url: '/f.pdf' });

describe('DeleteQuote', () => {
  it('self-delete by uploader in RECEPTION', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeReceptionDecision());
    await quoteRepo.create(makeQuote('d1', 'u1'));
    const uc = new DeleteQuote(decRepo, quoteRepo, audit);
    const q = await uc.execute({ decision_id: 'd1', quote_id: 'q1', actor_user_id: 'u1', actor_role: 'resident' });
    expect(q.isDeleted).toBe(true);
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.QUOTE_DELETED);
  });

  it('self-delete rejected when decision not in RECEPTION', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeVotingDecision());
    await quoteRepo.create(makeQuote('d2', 'u1'));
    const uc = new DeleteQuote(decRepo, quoteRepo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd2', quote_id: 'q1', actor_user_id: 'u1', actor_role: 'resident' })).rejects.toThrow();
  });

  it('admin can delete with reason', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeReceptionDecision());
    await quoteRepo.create(makeQuote('d1', 'u2'));
    const uc = new DeleteQuote(decRepo, quoteRepo, new InMemoryAuditRepo());
    const q = await uc.execute({ decision_id: 'd1', quote_id: 'q1', actor_user_id: 'admin-1', actor_role: 'admin', reason: 'duplicate' });
    expect(q.isDeleted).toBe(true);
    expect(q.deletion_reason).toBe('duplicate');
  });

  it('admin without reason is rejected', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeReceptionDecision());
    await quoteRepo.create(makeQuote('d1', 'u2'));
    const uc = new DeleteQuote(decRepo, quoteRepo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', quote_id: 'q1', actor_user_id: 'admin-1', actor_role: 'admin' })).rejects.toThrow();
  });

  it('resident deleting other user quote is rejected', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeReceptionDecision());
    await quoteRepo.create(makeQuote('d1', 'u2'));
    const uc = new DeleteQuote(decRepo, quoteRepo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', quote_id: 'q1', actor_user_id: 'u1', actor_role: 'resident' })).rejects.toThrow();
  });
});
