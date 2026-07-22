import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntry, PettyCashCurrency } from '../../domain/entities/PettyCashEntry';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
} from '@/core/domain/enums';
import { DomainError } from '@/core/errors';
import { resolvePettyCashCurrency } from './resolvePettyCashCurrency';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import type { IExchangeRateService } from '@/core/domain/ports/IExchangeRateService';

export interface RegisterIncomeDTO {
    buildingId: string;
    amount: number;                     // positive, in `currency`
    currency?: PettyCashCurrency;       // defaults to 'USD'
    description: string;
    userId: string;
    date?: Date;                        // rate date (defaults to today) for VES
}

/**
 * Record an INCOME entry in the petty-cash ledger (board replenishes
 * the fund manually). Single INSERT — no more two-step `saveFund` +
 * `saveTransaction` that used to produce the `fund.id = ''` bug.
 */
export class RegisterPettyCashIncome {
    constructor(
        private pettyCashRepo: PettyCashRepository,
        private buildingRepo?: IBuildingRepository,
        private exchangeRateService?: IExchangeRateService
    ) { }

    async execute(dto: RegisterIncomeDTO): Promise<PettyCashEntry> {
        if (!(dto.amount > 0)) {
            throw new DomainError(
                'Income amount must be greater than zero',
                'VALIDATION_ERROR',
                400
            );
        }

        const fund = await this.pettyCashRepo.findOrCreateFund(dto.buildingId);

        // sign = +1 (income adds to the fund).
        const conv = await resolvePettyCashCurrency({
            buildingId: dto.buildingId,
            amount: dto.amount,
            currency: dto.currency ?? 'USD',
            sign: 1,
            date: dto.date,
            buildingRepo: this.buildingRepo,
            exchangeRateService: this.exchangeRateService,
        });

        const entry = new PettyCashEntry({
            fund_id: fund.id,
            type: PettyCashEntryType.INCOME,
            amount: conv.canonical,             // positive
            original_currency: conv.original_currency,
            original_amount: conv.original_amount,
            exchange_rate: conv.exchange_rate,
            rate_source: conv.rate_source,
            rate_date: conv.rate_date,
            description: dto.description,
            reference_type: PettyCashEntryReferenceType.MANUAL,
            created_by: dto.userId,
        });

        return await this.pettyCashRepo.addEntry(entry);
    }
}
