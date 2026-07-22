import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntry, PettyCashCurrency } from '../../domain/entities/PettyCashEntry';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
    PettyCashCategory,
} from '@/core/domain/enums';
import { DomainError } from '@/core/errors';
import { resolvePettyCashCurrency } from './resolvePettyCashCurrency';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import type { IExchangeRateService } from '@/core/domain/ports/IExchangeRateService';

export interface RegisterExpenseDTO {
    buildingId: string;
    amount: number;                     // positive — the actual spend, in `currency`
    currency?: PettyCashCurrency;       // defaults to 'USD'
    description: string;
    category: PettyCashCategory;
    userId: string;
    evidenceUrl?: string;
    date?: Date;                        // rate date (defaults to today) for VES
}

/**
 * Record an EXPENSE entry in the petty-cash ledger. Single INSERT.
 *
 * Balance MAY go negative: if the board spends more than the current
 * balance the fund is overdrawn by (amount - balance). That overdraft
 * is reflected naturally in the view (`petty_cash_balance.balance`
 * becomes negative) and is what the next assessment collects from the
 * units. No building-level PAID fantasma invoices are generated
 * anymore — the expense lives only in the ledger.
 */
export class RegisterPettyCashExpense {
    constructor(
        private pettyCashRepo: PettyCashRepository,
        private buildingRepo?: IBuildingRepository,
        private exchangeRateService?: IExchangeRateService
    ) { }

    async execute(dto: RegisterExpenseDTO): Promise<PettyCashEntry> {
        if (!(dto.amount > 0)) {
            throw new DomainError(
                'Expense amount must be greater than zero',
                'VALIDATION_ERROR',
                400
            );
        }

        const fund = await this.pettyCashRepo.findOrCreateFund(dto.buildingId);

        // sign = -1 (expense subtracts). resolve() returns negative canonical/original.
        const conv = await resolvePettyCashCurrency({
            buildingId: dto.buildingId,
            amount: dto.amount,
            currency: dto.currency ?? 'USD',
            sign: -1,
            date: dto.date,
            buildingRepo: this.buildingRepo,
            exchangeRateService: this.exchangeRateService,
        });

        const entry = new PettyCashEntry({
            fund_id: fund.id,
            type: PettyCashEntryType.EXPENSE,
            amount: conv.canonical,         // NEGATIVE — sign encodes direction
            original_currency: conv.original_currency,
            original_amount: conv.original_amount,
            exchange_rate: conv.exchange_rate,
            rate_source: conv.rate_source,
            rate_date: conv.rate_date,
            category: dto.category,
            description: dto.description,
            evidence_url: dto.evidenceUrl ?? null,
            reference_type: PettyCashEntryReferenceType.MANUAL,
            created_by: dto.userId,
        });

        return await this.pettyCashRepo.addEntry(entry);
    }
}
