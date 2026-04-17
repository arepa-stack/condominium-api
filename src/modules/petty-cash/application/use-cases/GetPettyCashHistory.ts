import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntryType, PettyCashCategory } from '@/core/domain/enums';

export interface GetPettyCashHistoryFilters {
    type?: PettyCashEntryType;
    category?: PettyCashCategory;
    page?: number;
    limit?: number;
}

/**
 * Read the ledger history for a building's petty cash fund.
 * Returns entries ordered by created_at desc (newest first).
 *
 * If the fund doesn't exist yet, returns an empty array rather than
 * 404 — semantically "this building has no activity yet" is not
 * an error condition.
 */
export class GetPettyCashHistory {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(buildingId: string, filters: GetPettyCashHistoryFilters) {
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);
        if (!fund) return [];

        const limit = filters.limit || 10;
        const page = filters.page || 1;
        const offset = (page - 1) * limit;

        const entries = await this.pettyCashRepo.findEntriesByFundId(fund.id, {
            type: filters.type,
            category: filters.category,
            limit,
            offset,
        });

        return entries.map(e => e.toJSON());
    }
}
