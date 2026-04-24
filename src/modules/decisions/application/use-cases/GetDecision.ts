import { DomainError } from '@/core/errors';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionVoteRepository,
} from '@/modules/decisions/domain/repository';
import {
  computeTally,
  computeEarlyFinalizeSignal,
} from '@/modules/decisions/domain/services/TallyService';
import type { ResultsDTO, TallyEntry, TotalApartmentsLookup } from './GetResults';

/**
 * Detail endpoint payload. `tally` mirrors the shape returned by
 * `GET /decisions/:id/results` (ResultsDTO) so the client can render
 * the same widget from either source.
 */
export class GetDecision {
  constructor(
    private readonly decisionRepo: DecisionRepository,
    private readonly quoteRepo: DecisionQuoteRepository,
    private readonly voteRepo: DecisionVoteRepository,
    private readonly totalApartments: TotalApartmentsLookup,
  ) {}

  async execute(id: string, opts: { caller_user_id: string | null }) {
    const decision = await this.decisionRepo.findById(id);
    if (!decision) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);

    const quotes = await this.quoteRepo.listForDecision(id);
    const allVotes = await this.voteRepo.listForDecision(id);

    const round = decision.current_round;
    const raw = computeTally(
      allVotes.map((v) => ({
        apartment_id: v.apartment_id,
        quote_id: v.quote_id,
        round: v.round,
      })),
      round,
    );

    const totalApt = await this.totalApartments(decision.building_id);

    const tallies: TallyEntry[] = quotes
      .map((q) => {
        const votesForQ = raw.totals[q.id] ?? 0;
        return {
          quote_id: q.id,
          provider_name: q.provider_name,
          amount: q.amount,
          votes: votesForQ,
          pct: raw.total_votes ? (votesForQ / raw.total_votes) * 100 : 0,
        };
      })
      .sort((a, b) => b.votes - a.votes);

    const earlySignal = computeEarlyFinalizeSignal(raw, totalApt, decision.status);

    const tally: ResultsDTO = {
      round,
      status: decision.status,
      total_apartments: totalApt,
      total_votes: raw.total_votes,
      participation_pct: totalApt ? (raw.total_votes / totalApt) * 100 : 0,
      tallies,
      winner_quote_id: decision.status === 'RESOLVED' ? decision.winner_quote_id : null,
      is_tied: raw.is_tied,
      is_early_finalizable: earlySignal.is_early_finalizable,
      early_finalize_reason: earlySignal.early_finalize_reason,
    };

    const my_vote =
      opts.caller_user_id != null
        ? (allVotes.find(
            (v) =>
              v.voted_by_user_id === opts.caller_user_id &&
              v.round === decision.current_round,
          ) ?? null)
        : null;

    return { decision, quotes, tally, my_vote };
  }
}
