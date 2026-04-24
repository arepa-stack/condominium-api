import { describe, it, expect } from 'bun:test';
import { DecisionVote, DecisionVoteProps } from '@/modules/decisions/domain/entities/DecisionVote';

const base = (o: Partial<DecisionVoteProps> = {}): DecisionVoteProps => ({
    id: 'v1', decision_id: 'd1', round: 1,
    apartment_id: 'apt1', quote_id: 'q1', voted_by_user_id: 'u1', ...o,
});

describe('DecisionVote Entity', () => {
    it('creates valid vote with defaults', () => {
        const v = new DecisionVote(base());
        expect(v.round).toBe(1);
        expect(v.created_at).toBeInstanceOf(Date);
    });

    it('requires round >= 1', () => {
        expect(() => new DecisionVote(base({ round: 0 }))).toThrow();
        expect(() => new DecisionVote(base({ round: -1 }))).toThrow();
    });

    it('requires non-empty decision_id', () => {
        expect(() => new DecisionVote(base({ decision_id: '' }))).toThrow();
        expect(() => new DecisionVote(base({ decision_id: '   ' }))).toThrow();
    });

    it('requires non-empty apartment_id', () => {
        expect(() => new DecisionVote(base({ apartment_id: '' }))).toThrow();
        expect(() => new DecisionVote(base({ apartment_id: '   ' }))).toThrow();
    });

    it('requires non-empty quote_id', () => {
        expect(() => new DecisionVote(base({ quote_id: '' }))).toThrow();
        expect(() => new DecisionVote(base({ quote_id: '   ' }))).toThrow();
    });

    it('allows null voted_by_user_id (profile may be deleted)', () => {
        const v = new DecisionVote(base({ voted_by_user_id: null }));
        expect(v.voted_by_user_id).toBeNull();
    });

    it('toJSON returns enumerated fields (voted_by expanded per spec §6.4)', () => {
        const v = new DecisionVote(base({ voted_by: { id: 'u1', name: 'Juan' } }));
        const j = v.toJSON();
        expect(j).toHaveProperty('id');
        expect(j).toHaveProperty('decision_id');
        expect(j).toHaveProperty('round');
        expect(j).toHaveProperty('apartment_id');
        expect(j).toHaveProperty('quote_id');
        expect(j).toHaveProperty('voted_by');
        expect(j.voted_by).toEqual({ id: 'u1', name: 'Juan' });
        expect(j).toHaveProperty('created_at');
    });

    it('toJSON voted_by is null when profile reference unavailable', () => {
        const v = new DecisionVote(base({ voted_by_user_id: null }));
        expect(v.toJSON().voted_by).toBeNull();
    });
});
