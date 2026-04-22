import { describe, it, expect } from 'bun:test';
import { ExtendDeadlines } from '@/modules/decisions/application/use-cases/ExtendDeadlines';
import { InMemoryDecisionRepo, InMemoryAuditRepo } from '../fakes';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const future = (ms: number) => new Date(Date.now() + ms);
const past = (ms: number) => new Date(Date.now() - ms);

const makeDecision = () =>
  new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: future(60_000), voting_deadline: future(120_000) });

describe('ExtendDeadlines', () => {
  it('extends both deadlines', async () => {
    const repo = new InMemoryDecisionRepo();
    const audit = new InMemoryAuditRepo();
    await repo.create(makeDecision());
    const uc = new ExtendDeadlines(repo, audit);
    const newR = future(600_000);
    const newV = future(1_200_000);
    const d = await uc.execute({ decision_id: 'd1', reception_deadline: newR, voting_deadline: newV, reason: 'need more time', actor_user_id: 'admin-1' });
    expect(d.reception_deadline.getTime()).toBe(newR.getTime());
    expect(d.voting_deadline.getTime()).toBe(newV.getTime());
    const logs = await audit.listForDecision('d1');
    expect(logs[0].event).toBe(AuditEvent.DEADLINE_EXTENDED);
  });

  it('rejects when reason is missing', async () => {
    const repo = new InMemoryDecisionRepo();
    await repo.create(makeDecision());
    const uc = new ExtendDeadlines(repo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', voting_deadline: future(300_000), reason: '', actor_user_id: 'admin-1' })).rejects.toThrow();
  });

  it('rejects extending reception_deadline in VOTING status', async () => {
    const repo = new InMemoryDecisionRepo();
    const d = new Decision({ id: 'd1', building_id: 'b1', created_by: 'u1', title: 'Reparación portón', reception_deadline: past(5000), voting_deadline: future(60_000), status: DecisionStatus.VOTING });
    await repo.create(d);
    const uc = new ExtendDeadlines(repo, new InMemoryAuditRepo());
    await expect(uc.execute({ decision_id: 'd1', reception_deadline: future(120_000), reason: 'test', actor_user_id: 'admin-1' })).rejects.toThrow();
  });
});
