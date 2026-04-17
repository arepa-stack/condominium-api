import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';

/**
 * Read the current live balance for a building's petty cash fund.
 * Balance is always DERIVED from the ledger view — no cached column.
 *
 * If the fund row doesn't exist yet (no income or expense ever
 * recorded), returns a zero-balance placeholder. The handler never
 * creates a fund; write flows (income/expense) do.
 */
export class GetPettyCashBalance {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(buildingId: string) {
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);

        if (!fund) {
            return {
                id: '',
                building_id: buildingId,
                current_balance: 0,
                updated_at: new Date(),
            };
        }

        const balance = await this.pettyCashRepo.getBalance(fund.id);

        return {
            id: fund.id,
            building_id: fund.building_id,
            current_balance: balance,
            updated_at: fund.updated_at,
        };
    }
}
