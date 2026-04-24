import { describe, it, expect } from 'bun:test';
import {
  computeTally,
  computeEarlyFinalizeSignal,
  TallyVote,
} from '@/modules/decisions/domain/services/TallyService';

const v = (apt: string, quote: string, round = 1): TallyVote => ({
  apartment_id: apt,
  quote_id: quote,
  round,
});

describe('TallyService.computeTally', () => {
  // --- Plan tests ---

  it('zero votes → empty tally, is_tied=true, reason=NO_VOTES', () => {
    const r = computeTally([], 1);
    expect(r.is_tied).toBe(true);
    expect(r.tied_quote_ids).toEqual([]);
    expect(r.winner_quote_id).toBeNull();
    expect(r.reason).toBe('NO_VOTES');
  });

  it('single winner', () => {
    const r = computeTally([v('a', 'q1'), v('b', 'q1'), v('c', 'q2')], 1);
    expect(r.is_tied).toBe(false);
    expect(r.winner_quote_id).toBe('q1');
    expect(r.totals['q1']).toBe(2);
    expect(r.totals['q2']).toBe(1);
  });

  it('two-way tie', () => {
    const r = computeTally([v('a', 'q1'), v('b', 'q2')], 1);
    expect(r.is_tied).toBe(true);
    expect(r.tied_quote_ids.sort()).toEqual(['q1', 'q2']);
    expect(r.winner_quote_id).toBeNull();
  });

  it('three-way tie', () => {
    const r = computeTally([v('a', 'q1'), v('b', 'q2'), v('c', 'q3')], 1);
    expect(r.is_tied).toBe(true);
    expect(r.tied_quote_ids.length).toBe(3);
  });

  it('round 2 ignores round 1 votes', () => {
    const all = [v('a', 'q1', 1), v('b', 'q1', 1), v('c', 'q1', 2), v('d', 'q2', 2)];
    const r = computeTally(all, 2);
    expect(r.totals['q1']).toBe(1);
    expect(r.totals['q2']).toBe(1);
    expect(r.is_tied).toBe(true);
  });

  // --- Proactive tests ---

  it('single vote on one quote → clear winner, total_votes=1', () => {
    const r = computeTally([v('a', 'q1')], 1);
    expect(r.is_tied).toBe(false);
    expect(r.winner_quote_id).toBe('q1');
    expect(r.totals['q1']).toBe(1);
    expect(r.total_votes).toBe(1);
  });

  it('totals only contains quotes that received votes in the given round', () => {
    // q3 exists conceptually in the decision but got no votes in round 1
    const r = computeTally([v('a', 'q1'), v('b', 'q2')], 1);
    expect(Object.keys(r.totals).sort()).toEqual(['q1', 'q2']);
    expect('q3' in r.totals).toBe(false);
  });
});

describe('TallyService.computeEarlyFinalizeSignal', () => {
  it('returns { false, null } when status is not VOTING', () => {
    const tally = computeTally([v('a', 'q1')], 1);
    for (const status of ['RECEPTION', 'TIEBREAK_PENDING', 'RESOLVED', 'CANCELLED']) {
      const s = computeEarlyFinalizeSignal(tally, 10, status);
      expect(s.is_early_finalizable).toBe(false);
      expect(s.early_finalize_reason).toBeNull();
    }
  });

  it('returns { false, null } when total_apartments is 0', () => {
    const tally = computeTally([], 1);
    const s = computeEarlyFinalizeSignal(tally, 0, 'VOTING');
    expect(s.is_early_finalizable).toBe(false);
    expect(s.early_finalize_reason).toBeNull();
  });

  it('ALL_VOTED when total_votes equals total_apartments', () => {
    // 3 apts, 3 votes cast (all to q1)
    const tally = computeTally(
      [v('a', 'q1'), v('b', 'q1'), v('c', 'q1')],
      1,
    );
    const s = computeEarlyFinalizeSignal(tally, 3, 'VOTING');
    expect(s.is_early_finalizable).toBe(true);
    expect(s.early_finalize_reason).toBe('ALL_VOTED');
  });

  it('ALL_VOTED even when tied (admin still needs to act)', () => {
    // 2 apts, 1 vote to q1, 1 vote to q2 → tied but all voted
    const tally = computeTally([v('a', 'q1'), v('b', 'q2')], 1);
    const s = computeEarlyFinalizeSignal(tally, 2, 'VOTING');
    expect(s.is_early_finalizable).toBe(true);
    expect(s.early_finalize_reason).toBe('ALL_VOTED');
  });

  it('MATHEMATICALLY_DECIDED when leader lead exceeds remaining voters', () => {
    // 10 apts, q1=6, q2=2, remaining=2. 6-2=4 > 2 → decided.
    const votes = [
      ...Array.from({ length: 6 }, (_, i) => v('a' + i, 'q1')),
      ...Array.from({ length: 2 }, (_, i) => v('b' + i, 'q2')),
    ];
    const tally = computeTally(votes, 1);
    const s = computeEarlyFinalizeSignal(tally, 10, 'VOTING');
    expect(s.is_early_finalizable).toBe(true);
    expect(s.early_finalize_reason).toBe('MATHEMATICALLY_DECIDED');
  });

  it('returns null when leader lead equals remaining (tie still possible)', () => {
    // 10 apts, q1=5, q2=0, remaining=5. 5-0=5 not > 5 → not decided.
    const votes = Array.from({ length: 5 }, (_, i) => v('a' + i, 'q1'));
    const tally = computeTally(votes, 1);
    const s = computeEarlyFinalizeSignal(tally, 10, 'VOTING');
    expect(s.is_early_finalizable).toBe(false);
    expect(s.early_finalize_reason).toBeNull();
  });

  it('returns null when no votes cast yet', () => {
    const tally = computeTally([], 1);
    const s = computeEarlyFinalizeSignal(tally, 10, 'VOTING');
    expect(s.is_early_finalizable).toBe(false);
    expect(s.early_finalize_reason).toBeNull();
  });

  it('MATHEMATICALLY_DECIDED with only one quote receiving votes and lead > remaining', () => {
    // 5 apts, q1=3, remaining=2, second=0. 3-0=3 > 2 → decided.
    const votes = Array.from({ length: 3 }, (_, i) => v('a' + i, 'q1'));
    const tally = computeTally(votes, 1);
    const s = computeEarlyFinalizeSignal(tally, 5, 'VOTING');
    expect(s.is_early_finalizable).toBe(true);
    expect(s.early_finalize_reason).toBe('MATHEMATICALLY_DECIDED');
  });

  it('returns null on close race where remaining votes could flip the leader', () => {
    // 10 apts, q1=4, q2=3, remaining=3. 4-3=1 not > 3 → not decided.
    const votes = [
      ...Array.from({ length: 4 }, (_, i) => v('a' + i, 'q1')),
      ...Array.from({ length: 3 }, (_, i) => v('b' + i, 'q2')),
    ];
    const tally = computeTally(votes, 1);
    const s = computeEarlyFinalizeSignal(tally, 10, 'VOTING');
    expect(s.is_early_finalizable).toBe(false);
    expect(s.early_finalize_reason).toBeNull();
  });

  it('prefers ALL_VOTED over MATHEMATICALLY_DECIDED when both hold', () => {
    // 3 apts, q1=3, q2=0, remaining=0. Both hold; ALL_VOTED wins.
    const votes = Array.from({ length: 3 }, (_, i) => v('a' + i, 'q1'));
    const tally = computeTally(votes, 1);
    const s = computeEarlyFinalizeSignal(tally, 3, 'VOTING');
    expect(s.is_early_finalizable).toBe(true);
    expect(s.early_finalize_reason).toBe('ALL_VOTED');
  });
});
