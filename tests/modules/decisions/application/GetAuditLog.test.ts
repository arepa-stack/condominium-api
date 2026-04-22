import { describe, it, expect } from 'bun:test';
import { GetAuditLog } from '@/modules/decisions/application/use-cases/GetAuditLog';
import { InMemoryAuditRepo } from '../fakes';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

describe('GetAuditLog', () => {
  it('returns audit events for a decision', async () => {
    const audit = new InMemoryAuditRepo();
    await audit.record({ decision_id: 'd1', event: AuditEvent.CREATED, actor_user_id: 'u1' });
    await audit.record({ decision_id: 'd1', event: AuditEvent.PHASE_ADVANCED, actor_user_id: 'system' });
    await audit.record({ decision_id: 'd2', event: AuditEvent.CREATED, actor_user_id: 'u2' });
    const uc = new GetAuditLog(audit);
    const logs = await uc.execute('d1');
    expect(logs.length).toBe(2);
    expect(logs.every((l) => l.decision_id === 'd1')).toBe(true);
  });
});
