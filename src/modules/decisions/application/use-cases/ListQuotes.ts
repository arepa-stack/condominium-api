import {
  parsePaginationFilters,
  buildPaginatedResult,
  PaginatedResult,
} from '@/core/domain/pagination';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionQuoteRepository } from '@/modules/decisions/domain/repository';

export interface ListQuotesPaginatedInput {
  decision_id: string;
  include_deleted?: boolean;
  page?: number | string;
  limit?: number | string;
}

export class ListQuotes {
  constructor(private readonly quotes: DecisionQuoteRepository) {}

  async execute(decisionId: string, includeDeleted = false): Promise<DecisionQuote[]> {
    return this.quotes.listForDecision(decisionId, includeDeleted);
  }

  async executePaginated(input: ListQuotesPaginatedInput): Promise<PaginatedResult<DecisionQuote>> {
    const pagination = parsePaginationFilters({ page: input.page, limit: input.limit });
    const result = await this.quotes.listForDecisionPaginated(
      input.decision_id,
      input.include_deleted ?? false,
      { page: pagination.page, limit: pagination.limit },
    );
    return buildPaginatedResult(result.items, result.total, pagination);
  }
}
