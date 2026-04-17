import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntry } from '../../domain/entities/PettyCashEntry';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
} from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

export interface RegisterIncomeDTO {
    buildingId: string;
    amount: number;
    description: string;
    userId: string;
}

/**
 * Record an INCOME entry in the petty-cash ledger (board replenishes
 * the fund manually). Single INSERT — no more two-step `saveFund` +
 * `saveTransaction` that used to produce the `fund.id = ''` bug.
 */
export class RegisterPettyCashIncome {
    constructor(private pettyCashRepo: PettyCashRepository) { }

    async execute(dto: RegisterIncomeDTO): Promise<PettyCashEntry> {
        if (!(dto.amount > 0)) {
            throw new DomainError(
                'Income amount must be greater than zero',
                'VALIDATION_ERROR',
                400
            );
        }

        const fund = await this.pettyCashRepo.findOrCreateFund(dto.buildingId);

        const entry = new PettyCashEntry({
            fund_id: fund.id,
            type: PettyCashEntryType.INCOME,
            amount: dto.amount,                 // positive
            description: dto.description,
            reference_type: PettyCashEntryReferenceType.MANUAL,
            created_by: dto.userId,
        });

        return await this.pettyCashRepo.addEntry(entry);
    }
}
