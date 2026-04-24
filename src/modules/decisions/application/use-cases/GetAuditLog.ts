import {
  parsePaginationFilters,
  buildPaginatedResult,
  PaginatedResult,
} from '@/core/domain/pagination';
import { DecisionAuditLog } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export interface GetAuditLogPaginatedInput {
  decision_id: string;
  page?: number | string;
  limit?: number | string;
}

export class GetAuditLog {
  constructor(private readonly audit: DecisionAuditLogRepository) {}

  async execute(decisionId: string): Promise<DecisionAuditLog[]> {
    return this.audit.listForDecision(decisionId);
  }

  async executePaginated(
    input: GetAuditLogPaginatedInput,
  ): Promise<PaginatedResult<DecisionAuditLog>> {
    const pagination = parsePaginationFilters({ page: input.page, limit: input.limit });
    const result = await this.audit.listForDecisionPaginated(input.decision_id, {
      page: pagination.page,
      limit: pagination.limit,
    });
    return buildPaginatedResult(result.items, result.total, pagination);
  }
}
