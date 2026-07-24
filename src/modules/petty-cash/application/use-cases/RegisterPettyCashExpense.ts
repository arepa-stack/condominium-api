import { PettyCashRepository } from '../../domain/repositories/PettyCashRepository';
import { PettyCashEntry, PettyCashCurrency } from '../../domain/entities/PettyCashEntry';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
    PettyCashCategory,
    InvoiceTag,
} from '@/core/domain/enums';
import { DomainError } from '@/core/errors';
import { resolvePettyCashCurrency } from './resolvePettyCashCurrency';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { IInvoiceRepository } from '@/modules/billing/domain/repository';
import { computeCoverage } from './computeCoverage';
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

export interface ExpenseCoverage {
    /** Amount still needed to bring the fund to target (or eliminate overdraft). */
    pending_to_assess: number;
    /** Current ledger balance after this expense. */
    balance: number;
    /** Target replenishment fund amount. */
    target_fund: number;
}

export type RegisterExpenseResult = ReturnType<PettyCashEntry['toJSON']> & {
    /** Optional coverage data. Present only when the invoiceRepo dep is wired. */
    coverage?: ExpenseCoverage;
};

const toCents = (n: number): number => Math.round(n * 100);
const fromCents = (c: number): number => c / 100;

/**
 * Record an EXPENSE entry in the petty-cash ledger. Single INSERT.
 *
 * Balance MAY go negative: if the board spends more than the current
 * balance the fund is overdrawn by (amount - balance). That overdraft
 * is reflected naturally in the view (`petty_cash_balance.balance`
 * becomes negative) and is what the next assessment collects from the
 * units. No building-level PAID fantasma invoices are generated
 * anymore — the expense lives only in the ledger.
 *
 * When `invoiceRepo` is provided, the response includes an optional
 * `coverage` object with pending_to_assess, balance, and target_fund.
 * Backward compatible — callers that do not inject this dep receive
 * the raw entry as before.
 */
export class RegisterPettyCashExpense {
    constructor(
        private pettyCashRepo: PettyCashRepository,
        private buildingRepo?: IBuildingRepository,
        private exchangeRateService?: IExchangeRateService,
        private invoiceRepo?: IInvoiceRepository
    ) { }

    async execute(dto: RegisterExpenseDTO): Promise<RegisterExpenseResult> {
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

        const saved = await this.pettyCashRepo.addEntry(entry);

        // ── Optional coverage computation ─────────────────────────────────────
        // Compute coverage after the entry is persisted so the balance is accurate.
        if (this.invoiceRepo) {
            const balance = await this.pettyCashRepo.getBalance(fund.id);
            const balanceCents = toCents(balance);
            const targetFundCents = toCents(fund.target_fund ?? 0);

            const allInvoices = await this.invoiceRepo.findAll({
                building_id: dto.buildingId,
                tag: InvoiceTag.PETTY_CASH,
            });

            const { pendingCents: rawPendingCents } = computeCoverage({
                balanceCents,
                targetFundCents,
                invoices: allInvoices,
            });

            const pendingCents = rawPendingCents < 1 ? 0 : rawPendingCents;

            const coverage: ExpenseCoverage = {
                pending_to_assess: fromCents(pendingCents),
                balance,
                target_fund: fromCents(targetFundCents),
            };

            return { ...saved.toJSON(), coverage };
        }

        return saved.toJSON();
    }
}
