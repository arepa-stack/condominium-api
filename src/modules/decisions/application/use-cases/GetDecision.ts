import { DomainError } from '@/core/errors';
import { DecisionRepository, DecisionQuoteRepository, DecisionVoteRepository } from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';

export class GetDecision {
  constructor(
    private readonly decisionRepo: DecisionRepository,
    private readonly quoteRepo: DecisionQuoteRepository,
    private readonly voteRepo: DecisionVoteRepository,
  ) {}

  async execute(id: string, opts: { caller_user_id: string | null }) {
    const decision = await this.decisionRepo.findById(id);
    if (!decision) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);

    const quotes = await this.quoteRepo.listForDecision(id);
    const allVotes = await this.voteRepo.listForDecision(id);

    const tally = computeTally(
      allVotes.map((v) => ({
        apartment_id: v.apartment_id,
        quote_id: v.quote_id,
        round: v.round,
      })),
      decision.current_round,
    );

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
