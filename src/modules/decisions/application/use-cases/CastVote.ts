import { randomUUID } from 'crypto';
import { DomainError } from '@/core/errors';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import {
  DecisionRepository,
  DecisionQuoteRepository,
  DecisionVoteRepository,
} from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';

export interface CastVoteInput {
  decision_id: string;
  apartment_id: string;
  quote_id: string;
  voter_user_id: string;
}

export class CastVote {
  constructor(
    private readonly decisions: DecisionRepository,
    private readonly quotes: DecisionQuoteRepository,
    private readonly votes: DecisionVoteRepository,
  ) {}

  async execute(input: CastVoteInput): Promise<DecisionVote> {
    const d = await this.decisions.findById(input.decision_id);
    if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
    if (d.status !== DecisionStatus.VOTING) {
      throw new DomainError('decision is not in VOTING', 'DECISION_WRONG_STATUS', 422);
    }
    if (d.voting_deadline.getTime() <= Date.now()) {
      throw new DomainError('voting deadline passed', 'DECISION_WRONG_STATUS', 422);
    }

    const q = await this.quotes.findById(input.quote_id);
    if (!q || q.decision_id !== d.id) {
      throw new DomainError('quote not found', 'QUOTE_NOT_FOUND', 404);
    }
    if (q.isDeleted) {
      throw new DomainError('quote has been deleted', 'QUOTE_DELETED', 422);
    }

    if (d.current_round > 1) {
      const previousRoundVotes = await this.votes.listForDecision(d.id, d.current_round - 1);
      const tally = computeTally(
        previousRoundVotes.map((v) => ({
          apartment_id: v.apartment_id,
          quote_id: v.quote_id,
          round: v.round,
        })),
        d.current_round - 1,
      );
      if (!tally.tied_quote_ids.includes(q.id)) {
        throw new DomainError('quote not in tiebreak set', 'QUOTE_NOT_IN_TIEBREAK', 422);
      }
    }

    try {
      return await this.votes.create(
        new DecisionVote({
          id: randomUUID(),
          decision_id: d.id,
          round: d.current_round,
          apartment_id: input.apartment_id,
          quote_id: input.quote_id,
          voted_by_user_id: input.voter_user_id,
        }),
      );
    } catch (e: any) {
      if (e.code === 'VOTE_ALREADY_CAST' || e.code === '23505') {
        throw new DomainError('already voted this round', 'VOTE_ALREADY_CAST', 409);
      }
      throw e;
    }
  }
}
