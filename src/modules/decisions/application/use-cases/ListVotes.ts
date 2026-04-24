import {
  parsePaginationFilters,
  buildPaginatedResult,
  PaginatedResult,
} from '@/core/domain/pagination';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { DecisionVoteRepository } from '@/modules/decisions/domain/repository';

export interface ListVotesPaginatedInput {
  decision_id: string;
  round?: number;
  page?: number | string;
  limit?: number | string;
}

export class ListVotes {
  constructor(private readonly votes: DecisionVoteRepository) {}

  async execute(decisionId: string, round?: number): Promise<DecisionVote[]> {
    return this.votes.listForDecision(decisionId, round);
  }

  async executePaginated(input: ListVotesPaginatedInput): Promise<PaginatedResult<DecisionVote>> {
    const pagination = parsePaginationFilters({ page: input.page, limit: input.limit });
    const result = await this.votes.listForDecisionPaginated(input.decision_id, input.round, {
      page: pagination.page,
      limit: pagination.limit,
    });
    return buildPaginatedResult(result.items, result.total, pagination);
  }
}
