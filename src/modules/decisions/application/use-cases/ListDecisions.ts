import {
  parsePaginationFilters,
  buildPaginatedResult,
  PaginatedResult,
} from '@/core/domain/pagination';
import { DecisionRepository } from '@/modules/decisions/domain/repository';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';

export interface ListDecisionsInput {
  page?: number;
  limit?: number | string;
  building_id?: string;
  statuses?: string;
  created_by?: string;
  search?: string;
  has_my_vote_user_id?: string;
}

export class ListDecisions {
  constructor(private readonly repo: DecisionRepository) {}

  async execute(input: ListDecisionsInput = {}): Promise<PaginatedResult<Decision>> {
    const pagination = parsePaginationFilters({ page: input.page, limit: input.limit });
    const statuses = input.statuses
      ? (input.statuses.split(',').filter(Boolean) as DecisionStatus[])
      : undefined;

    const result = await this.repo.list({
      building_id: input.building_id,
      statuses,
      created_by: input.created_by,
      search: input.search,
      has_my_vote_for_user_id: input.has_my_vote_user_id,
      pagination,
    });

    return buildPaginatedResult(result.items, result.total, pagination);
  }
}
