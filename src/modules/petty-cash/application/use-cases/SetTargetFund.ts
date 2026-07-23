import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { DomainError } from '@/core/errors';

export interface SetTargetFundDTO {
    buildingId: string;
    targetFund: number;
}

export interface SetTargetFundResult {
    building_id: string;
    target_fund: number;
}

/**
 * Update (or initialise) the target replenishment fund for a building.
 *
 * Cold-start safe: if the building has no fund row yet, `findOrCreateFund`
 * creates one before setting the target.
 *
 * Validation:
 *   - targetFund must be a finite number >= 0. Negative values are rejected
 *     with VALIDATION_ERROR (400). Zero is valid — it resets to overage-only
 *     mode (Slice A behaviour).
 */
export class SetTargetFund {
    constructor(private pettyCashRepo: PettyCashRepository) {}

    async execute(dto: SetTargetFundDTO): Promise<SetTargetFundResult> {
        const { buildingId, targetFund } = dto;

        if (!Number.isFinite(targetFund) || targetFund < 0) {
            throw new DomainError(
                'target_fund must be a finite number greater than or equal to 0',
                'VALIDATION_ERROR',
                400
            );
        }

        // Cold-start safe: creates the fund row if it does not exist yet.
        const fund = await this.pettyCashRepo.findOrCreateFund(buildingId);

        await this.pettyCashRepo.updateFundTargetFund(fund.id, targetFund);

        return { building_id: buildingId, target_fund: targetFund };
    }
}
