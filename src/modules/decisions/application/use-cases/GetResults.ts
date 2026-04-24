import { DomainError } from '@/core/errors';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionVoteRepository,
} from '@/modules/decisions/domain/repository';
import {
  computeTally,
  computeEarlyFinalizeSignal,
  EarlyFinalizeReason,
} from '@/modules/decisions/domain/services/TallyService';

export type TotalApartmentsLookup = (buildingId: string) => Promise<number>;

export interface TallyEntry {
  quote_id: string;
  provider_name: string;
  amount: number;
  votes: number;
  pct: number;
}

export interface ResultsDTO {
  round: number;
  status: string;
  total_apartments: number;
  total_votes: number;
  participation_pct: number;
  tallies: TallyEntry[];
  winner_quote_id: string | null;
  is_tied: boolean;
  is_early_finalizable: boolean;
  early_finalize_reason: EarlyFinalizeReason;
}

export class GetResults {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly votes: DecisionVoteRepository,
    private readonly totalApartments: TotalApartmentsLookup,
  ) {}

  async execute(decisionId: string, round?: number): Promise<ResultsDTO> {
    const d = await this.decisions.findById(decisionId);
    if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);

    const r = round ?? d.current_round;
    const quotes = await this.quotes.listForDecision(decisionId, true);
    const votes = await this.votes.listForDecision(decisionId, r);

    const tally = computeTally(
      votes.map((v) => ({
        apartment_id: v.apartment_id,
        quote_id: v.quote_id,
        round: v.round,
      })),
      r,
    );

    const totalApt = await this.totalApartments(d.building_id);

    const tallies: TallyEntry[] = quotes
      .map((q) => {
        const votesForQ = tally.totals[q.id] ?? 0;
        return {
          quote_id: q.id,
          provider_name: q.provider_name,
          amount: q.amount,
          votes: votesForQ,
          pct: tally.total_votes ? (votesForQ / tally.total_votes) * 100 : 0,
        };
      })
      .sort((a, b) => b.votes - a.votes);

    const earlySignal = computeEarlyFinalizeSignal(tally, totalApt, d.status);

    return {
      round: r,
      status: d.status,
      total_apartments: totalApt,
      total_votes: tally.total_votes,
      participation_pct: totalApt ? (tally.total_votes / totalApt) * 100 : 0,
      tallies,
      winner_quote_id: d.status === 'RESOLVED' ? d.winner_quote_id : null,
      is_tied: tally.is_tied,
      is_early_finalizable: earlySignal.is_early_finalizable,
      early_finalize_reason: earlySignal.early_finalize_reason,
    };
  }
}
