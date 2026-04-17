import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntryType, PettyCashCategory } from '@/core/domain/enums';
import {
    PaginatedResult,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export interface GetPettyCashHistoryFilters {
    type?: PettyCashEntryType;
    category?: PettyCashCategory;
    page?: number | string;
    limit?: number | string;
}

/**
 * Read the ledger history for a building's petty cash fund.
 * Returns entries ordered by created_at desc (newest first).
 *
 * If the fund doesn't exist yet, returns an empty paginated result
 * rather than 404 — semantically "this building has no activity yet" is
 * not an error condition.
 */
export class GetPettyCashHistory {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(
        buildingId: string,
        filters: GetPettyCashHistoryFilters
    ): Promise<PaginatedResult<Record<string, unknown>>> {
        const pagination = parsePaginationFilters({
            page: filters.page,
            limit: filters.limit,
        });

        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);
        if (!fund) return buildPaginatedResult<Record<string, unknown>>([], 0, pagination);

        const { items, total } = await this.pettyCashRepo.findEntriesByFundIdPaginated(
            fund.id,
            {
                type: filters.type,
                category: filters.category,
            },
            pagination
        );

        return buildPaginatedResult(
            items.map(e => e.toJSON() as Record<string, unknown>),
            total,
            pagination
        );
    }
}
