import { describe, it, expect } from 'bun:test';
import { computeTally, TallyVote } from '@/modules/decisions/domain/services/TallyService';

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
