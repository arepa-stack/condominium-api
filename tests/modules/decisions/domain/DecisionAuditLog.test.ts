import { describe, it, expect } from 'bun:test';
import { DecisionAuditLog, AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

describe('DecisionAuditLog', () => {
    it('creates with defaults', () => {
        const e = new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: AuditEvent.CREATED,
            actor_user_id: 'u1', payload: { foo: 1 },
        });
        expect(e.event).toBe(AuditEvent.CREATED);
        expect(e.created_at).toBeInstanceOf(Date);
    });

    it('rejects unknown event', () => {
        expect(() => new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: 'UNKNOWN' as any,
            actor_user_id: 'u1', payload: null,
        })).toThrow();
    });

    it('requires non-empty decision_id', () => {
        expect(() => new DecisionAuditLog({
            id: 'a1', decision_id: '', event: AuditEvent.CREATED,
            actor_user_id: 'u1', payload: null,
        })).toThrow();
        expect(() => new DecisionAuditLog({
            id: 'a1', decision_id: '   ', event: AuditEvent.CREATED,
            actor_user_id: 'u1', payload: null,
        })).toThrow();
    });

    it('allows null actor_user_id (profile may be deleted)', () => {
        const e = new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: AuditEvent.CREATED,
            actor_user_id: null, payload: null,
        });
        expect(e.actor_user_id).toBeNull();
    });

    it('allows null payload', () => {
        const e = new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: AuditEvent.CREATED,
            actor_user_id: 'u1', payload: null,
        });
        expect(e.payload).toBeNull();
    });

    it('toJSON returns enumerated fields', () => {
        const e = new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: AuditEvent.CREATED,
            actor_user_id: 'u1', payload: { foo: 1 },
        });
        const j = e.toJSON();
        expect(j).toHaveProperty('id');
        expect(j).toHaveProperty('decision_id');
        expect(j).toHaveProperty('event');
        expect(j).toHaveProperty('actor_user_id');
        expect(j).toHaveProperty('payload');
        expect(j).toHaveProperty('created_at');
    });

    it('enum has exactly 9 values matching DB CHECK', () => {
        expect(Object.values(AuditEvent).sort()).toEqual([
            'CANCELLED','CHARGE_GENERATED','CREATED','DEADLINE_EXTENDED',
            'FINALIZED','PHASE_ADVANCED','QUOTE_DELETED','TIEBREAK_OPENED','WINNER_SET_MANUAL',
        ]);
    });
});
