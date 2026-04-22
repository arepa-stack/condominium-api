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
