import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { NotFoundError } from '@/core/errors';

export class GetPettyCashBalance {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(buildingId: string) {
        const fund = await this.pettyCashRepo.findFundByBuildingId(buildingId);

        if (!fund) {
            // If no fund exists, return zero balance
            return {
                id: '',
                building_id: buildingId,
                current_balance: 0,
                currency: 'USD',
                updated_at: new Date()
            };
        }

        return fund.toJSON();
    }
}
