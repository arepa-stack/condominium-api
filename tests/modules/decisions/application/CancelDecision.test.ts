import { describe, it, expect } from 'bun:test';
import { CancelDecision } from '@/modules/decisions/application/use-cases/CancelDecision';
import { InMemoryDecisionRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

const makeDecision = () =>
  new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: future(60_000), voting_deadline: future(120_000) });

describe('CancelDecision', () => {
  it('cancels a RECEPTION decision', async () => {
    const repo = new InMemoryDecisionRepo();
    const audit = new InMemoryAuditRepo();
    await repo.create(makeDecision());
    const uc = new CancelDecision(repo, audit);
    const d = await uc.execute({ decision_id: 'd1', reason: 'No funds', actor_user_id: 'admin-1' });
    expect(d.status).toBe(DecisionStatus.CANCELLED);
    expect(d.cancel_reason).toBe('No funds');
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.CANCELLED);
  });

  it('throws when already resolved', async () => {
    const repo = new InMemoryDecisionRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(5000), voting_deadline: past(1000), status: DecisionStatus.RESOLVED, winner_quote_id: 'q1' });
    await repo.create(d);
    const uc = new CancelDecision(repo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', reason: 'test', actor_user_id: 'admin-1' })).rejects.toThrow();
  });

  it('throws when reason is empty', async () => {
    const repo = new InMemoryDecisionRepo();
    await repo.create(makeDecision());
    const uc = new CancelDecision(repo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', reason: '', actor_user_id: 'admin-1' })).rejects.toThrow();
  });
});
