import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
    PettyCashCategory,
} from '@/core/domain/enums';
import { DomainError } from '@/core/errors';
import type { RateSource } from '@/core/domain/ports/IExchangeRateService';

export type PettyCashCurrency = 'USD' | 'VES';

export interface PettyCashEntryProps {
    id?: string;
    fund_id: string;
    type: PettyCashEntryType;
    amount: number;                               // signed CANONICAL (base unit). See conventions below.
    // What actually moved. `original_amount` carries the SAME sign as `amount`.
    original_currency?: PettyCashCurrency;
    original_amount?: number | null;
    exchange_rate?: number | null;
    rate_source?: RateSource | null;
    rate_date?: string | null;
    category?: PettyCashCategory | null;          // expense only
    description: string;
    evidence_url?: string | null;
    reference_type?: PettyCashEntryReferenceType | null;
    reference_id?: string | null;
    created_by: string;
    created_at?: Date;
}

/**
 * An append-only row in `petty_cash_entries`.
 *
 * Sign conventions (enforced in the constructor):
 *   - income     → amount > 0
 *   - collection → amount > 0
 *   - expense    → amount < 0
 *   - reversal   → sign is the negation of whatever is being reversed
 *                   (both positive and negative are valid here; we only
 *                    require non-zero).
 *
 * `reference_type` + `reference_id` trace provenance:
 *   - manual            → reference_id null (board clicked a button).
 *   - invoice_payment   → reference_id = invoices.id of the PETTY_CASH
 *                         invoice the resident paid (auto-collection
 *                         loop fired by ApprovePayment).
 *   - reversal          → reference_id = the original entry being
 *                         counter-asiento'd.
 */
export class PettyCashEntry {
    constructor(private props: PettyCashEntryProps) {
        if (props.amount === 0) {
            throw new DomainError(
                'Petty cash entry amount cannot be zero',
                'VALIDATION_ERROR',
                400
            );
        }
        if (!props.fund_id) {
            throw new DomainError('fund_id is required', 'VALIDATION_ERROR', 400);
        }
        if (!props.description?.trim()) {
            throw new DomainError(
                'Description is required for a petty cash entry',
                'VALIDATION_ERROR',
                400
            );
        }
        if (!props.created_by) {
            throw new DomainError('created_by is required', 'VALIDATION_ERROR', 400);
        }

        this.assertSignMatchesType(props.type, props.amount);

        if (!props.created_at) {
            this.props.created_at = new Date();
        }
    }

    private assertSignMatchesType(type: PettyCashEntryType, amount: number): void {
        if (type === PettyCashEntryType.INCOME && amount <= 0) {
            throw new DomainError(
                'Income entries must have a positive amount',
                'VALIDATION_ERROR',
                400
            );
        }
        if (type === PettyCashEntryType.COLLECTION && amount <= 0) {
            throw new DomainError(
                'Collection entries must have a positive amount',
                'VALIDATION_ERROR',
                400
            );
        }
        if (type === PettyCashEntryType.EXPENSE && amount >= 0) {
            throw new DomainError(
                'Expense entries must have a negative amount',
                'VALIDATION_ERROR',
                400
            );
        }
        // REVERSAL accepts either sign (it is the negation of something else).
    }

    get id(): string | undefined { return this.props.id; }
    get fund_id(): string { return this.props.fund_id; }
    get type(): PettyCashEntryType { return this.props.type; }
    get amount(): number { return this.props.amount; }
    get original_currency(): PettyCashCurrency { return this.props.original_currency ?? 'USD'; }
    get original_amount(): number | null | undefined { return this.props.original_amount; }
    get exchange_rate(): number | null | undefined { return this.props.exchange_rate; }
    get rate_source(): RateSource | null | undefined { return this.props.rate_source; }
    get rate_date(): string | null | undefined { return this.props.rate_date; }
    get category(): PettyCashCategory | null | undefined { return this.props.category; }
    get description(): string { return this.props.description; }
    get evidence_url(): string | null | undefined { return this.props.evidence_url; }
    get reference_type(): PettyCashEntryReferenceType | null | undefined {
        return this.props.reference_type;
    }
    get reference_id(): string | null | undefined { return this.props.reference_id; }
    get created_by(): string { return this.props.created_by; }
    get created_at(): Date { return this.props.created_at!; }

    /**
     * Build a counter-asiento of an existing entry. The resulting entry
     * has `type = REVERSAL`, `amount = -original.amount`, preserves
     * fund_id, and sets reference_type/reference_id so the reversal
     * remains traceable back to the original.
     */
    static reversalOf(
        original: PettyCashEntry,
        opts: { description: string; createdBy: string }
    ): PettyCashEntry {
        if (!original.id) {
            throw new DomainError(
                'Cannot reverse an entry that has not been persisted yet',
                'VALIDATION_ERROR',
                400
            );
        }
        return new PettyCashEntry({
            fund_id: original.fund_id,
            type: PettyCashEntryType.REVERSAL,
            amount: -original.amount,
            // Mirror the original's currency so the by-currency balance nets to zero.
            original_currency: original.original_currency,
            original_amount: original.original_amount != null ? -original.original_amount : null,
            exchange_rate: original.exchange_rate,
            rate_source: original.rate_source,
            rate_date: original.rate_date,
            description: opts.description,
            reference_type: PettyCashEntryReferenceType.REVERSAL,
            reference_id: original.id,
            created_by: opts.createdBy,
        });
    }

    toJSON() {
        return {
            id: this.props.id,
            fund_id: this.props.fund_id,
            type: this.props.type,
            amount: this.props.amount,
            original_currency: this.original_currency,
            original_amount: this.props.original_amount ?? null,
            exchange_rate: this.props.exchange_rate ?? null,
            rate_source: this.props.rate_source ?? null,
            rate_date: this.props.rate_date ?? null,
            category: this.props.category ?? null,
            description: this.props.description,
            evidence_url: this.props.evidence_url ?? null,
            reference_type: this.props.reference_type ?? null,
            reference_id: this.props.reference_id ?? null,
            created_by: this.props.created_by,
            created_at: this.props.created_at,
        };
    }
}
