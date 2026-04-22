import { describe, it, expect } from 'bun:test';
import { ResolveTiebreak } from '@/modules/decisions/application/use-cases/ResolveTiebreak';
import { InMemoryDecisionRepo, InMemoryQuoteRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const past = (ms: number) => new Date(Date.now() - ms);
const future = (ms: number) => new Date(Date.now() + ms);

const makeTiebreakDecision = () =>
  new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(10_000), voting_deadline: past(1000), status: DecisionStatus.TIEBREAK_PENDING });

const makeQuote = (id: string, deleted = false) => {
  const q = new DecisionQuote({ id, decision_id: 'd1', uploader_user_id: 'u1', provider_name: 'Acme', amount: 1000, file_url: '/f.pdf' });
  if (deleted) q.softDelete('admin', 'test');
  return q;
};

describe('ResolveTiebreak', () => {
  it('resolves tiebreak with valid quote', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const audit = new InMemoryAuditRepo();
    await decRepo.create(makeTiebreakDecision());
    await quoteRepo.create(makeQuote('q1'));
    const uc = new ResolveTiebreak(decRepo, quoteRepo, audit);
    const d = await uc.execute({ decision_id: 'd1', winner_quote_id: 'q1', actor_user_id: 'admin-1' });
    expect(d.status).toBe(DecisionStatus.RESOLVED);
    expect(d.winner_quote_id).toBe('q1');
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.WINNER_SET_MANUAL);
  });

  it('throws when decision is not in TIEBREAK_PENDING', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: future(60_000), voting_deadline: future(120_000) });
    await decRepo.create(d);
    await quoteRepo.create(makeQuote('q1'));
    const uc = new ResolveTiebreak(decRepo, quoteRepo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', winner_quote_id: 'q1', actor_user_id: 'admin-1' })).rejects.toThrow();
  });

  it('throws when winner quote is deleted', async () => {
    const decRepo = new InMemoryDecisionRepo();
    const quoteRepo = new InMemoryQuoteRepo();
    await decRepo.create(makeTiebreakDecision());
    await quoteRepo.create(makeQuote('q1', true));
    const uc = new ResolveTiebreak(decRepo, quoteRepo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', winner_quote_id: 'q1', actor_user_id: 'admin-1' })).rejects.toThrow();
  });
});
