import { describe, it, expect } from 'bun:test';
import { CreateDecision } from '@/modules/decisions/application/use-cases/CreateDecision';
import { InMemoryDecisionRepo, InMemoryAuditRepo } from '../fakes';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const future = (ms: number) => new Date(Date.now() + ms);

describe('CreateDecision', () => {
  it('creates a decision and audit-logs CREATED', async () => {
    const repo = new InMemoryDecisionRepo();
    const audit = new InMemoryAuditRepo();
    const uc = new CreateDecision(repo, audit);
    const d = await uc.execute({
      building_id: 'b1',
      actor_user_id: 'u1',
      title: 'Reparación portón',
      reception_deadline: future(60_000),
      voting_deadline: future(120_000),
    });
    expect(d.title).toBe('Reparación portón');
    expect(d.created_by).toBe('u1');
    const logs = await audit.listForDecision(d.id);
    expect(logs.length).toBe(1);
    expect(logs[0].event).toBe(AuditEvent.CREATED);
  });

  it('rejects bad deadlines (voting <= reception)', async () => {
    const uc = new CreateDecision(new InMemoryDecisionRepo(), new InMemoryAuditRepo());
    await expect(
      uc.execute({
        building_id: 'b1',
        actor_user_id: 'u1',
        title: 'foo bar',
        reception_deadline: future(60_000),
        voting_deadline: future(30_000),
      }),
    ).rejects.toThrow();
  });

  it('persists decision in repo', async () => {
    const repo = new InMemoryDecisionRepo();
    const uc = new CreateDecision(repo, new InMemoryAuditRepo());
    const d = await uc.execute({
      building_id: 'b1',
      actor_user_id: 'u1',
      title: 'Reparación ascensor',
      reception_deadline: future(60_000),
      voting_deadline: future(120_000),
    });
    expect(await repo.findById(d.id)).not.toBeNull();
  });
});
