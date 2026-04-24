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

describe('GetAuditLog.executePaginated', () => {
  it('returns empty paginated result when no entries', async () => {
    const audit = new InMemoryAuditRepo();
    const uc = new GetAuditLog(audit);
    const result = await uc.executePaginated({ decision_id: 'd1' });
    expect(result.data).toEqual([]);
    expect(result.metadata.total).toBe(0);
    expect(result.metadata.total_pages).toBe(0);
    expect(result.metadata.has_next_page).toBe(false);
    expect(result.metadata.has_prev_page).toBe(false);
  });

  it('returns single page when total fits within limit', async () => {
    const audit = new InMemoryAuditRepo();
    await audit.record({ decision_id: 'd1', event: AuditEvent.CREATED, actor_user_id: 'u1' });
    await audit.record({ decision_id: 'd1', event: AuditEvent.PHASE_ADVANCED, actor_user_id: 'u1' });
    const uc = new GetAuditLog(audit);
    const result = await uc.executePaginated({ decision_id: 'd1', limit: 20 });
    expect(result.data.length).toBe(2);
    expect(result.metadata.total).toBe(2);
    expect(result.metadata.total_pages).toBe(1);
    expect(result.metadata.has_next_page).toBe(false);
  });

  it('paginates across multiple pages', async () => {
    const audit = new InMemoryAuditRepo();
    for (let i = 0; i < 15; i++) {
      await audit.record({ decision_id: 'd1', event: AuditEvent.PHASE_ADVANCED, actor_user_id: 'u1' });
    }
    const uc = new GetAuditLog(audit);
    const page1 = await uc.executePaginated({ decision_id: 'd1', page: 1, limit: 5 });
    expect(page1.data.length).toBe(5);
    expect(page1.metadata.total).toBe(15);
    expect(page1.metadata.total_pages).toBe(3);
    expect(page1.metadata.has_next_page).toBe(true);

    const page2 = await uc.executePaginated({ decision_id: 'd1', page: 2, limit: 5 });
    expect(page2.data.length).toBe(5);
    expect(page2.metadata.has_prev_page).toBe(true);
    expect(page2.metadata.has_next_page).toBe(true);
  });
});
