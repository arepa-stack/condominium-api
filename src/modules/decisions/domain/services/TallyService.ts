export interface TallyVote {
  apartment_id: string;
  quote_id: string;
  round: number;
}

export interface TallyResult {
  totals: Record<string, number>;
  winner_quote_id: string | null;
  is_tied: boolean;
  tied_quote_ids: string[];
  total_votes: number;
  reason?: 'NO_VOTES';
}

export function computeTally(votes: TallyVote[], round: number): TallyResult {
  const filtered = votes.filter((v) => v.round === round);

  const totals: Record<string, number> = {};
  for (const v of filtered) {
    totals[v.quote_id] = (totals[v.quote_id] ?? 0) + 1;
  }

  if (filtered.length === 0) {
    return {
      totals,
      winner_quote_id: null,
      is_tied: true,
      tied_quote_ids: [],
      total_votes: 0,
      reason: 'NO_VOTES',
    };
  }

  const max = Math.max(...Object.values(totals));
  const winners = Object.entries(totals)
    .filter(([, n]) => n === max)
    .map(([qid]) => qid);

  if (winners.length === 1) {
    return {
      totals,
      winner_quote_id: winners[0],
      is_tied: false,
      tied_quote_ids: [],
      total_votes: filtered.length,
    };
  }

  return {
    totals,
    winner_quote_id: null,
    is_tied: true,
    tied_quote_ids: winners,
    total_votes: filtered.length,
  };
}

export type EarlyFinalizeReason = 'ALL_VOTED' | 'MATHEMATICALLY_DECIDED' | null;

export interface EarlyFinalizeSignal {
  is_early_finalizable: boolean;
  early_finalize_reason: EarlyFinalizeReason;
}

/**
 * Signals whether admin/board can finalize the decision RIGHT NOW without
 * waiting for `voting_deadline`. Derived, not authoritative — the actual
 * finalize call re-tallies under a lock.
 *
 * - `ALL_VOTED`: every apartment has voted. Finalize resolves or opens tiebreak.
 * - `MATHEMATICALLY_DECIDED`: leader's lead over the next-best candidate
 *   exceeds the remaining eligible voters. No remaining vote can change
 *   the winner, so waiting serves no purpose.
 *
 * Only meaningful while `status === 'VOTING'`.
 */
export function computeEarlyFinalizeSignal(
  tally: TallyResult,
  totalApartments: number,
  status: string,
): EarlyFinalizeSignal {
  if (status !== 'VOTING' || totalApartments <= 0) {
    return { is_early_finalizable: false, early_finalize_reason: null };
  }

  const remaining = totalApartments - tally.total_votes;

  if (remaining <= 0) {
    return { is_early_finalizable: true, early_finalize_reason: 'ALL_VOTED' };
  }

  const counts = Object.values(tally.totals);
  if (counts.length === 0) {
    return { is_early_finalizable: false, early_finalize_reason: null };
  }

  const sorted = counts.slice().sort((a, b) => b - a);
  const leader = sorted[0];
  const second = sorted[1] ?? 0;

  if (leader - second > remaining) {
    return {
      is_early_finalizable: true,
      early_finalize_reason: 'MATHEMATICALLY_DECIDED',
    };
  }

  return { is_early_finalizable: false, early_finalize_reason: null };
}
