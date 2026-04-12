import { DomainError } from '../../../../core/errors';

export enum CreditLedgerReferenceType {
    PAYMENT = 'payment',
    REVERSAL = 'reversal',
    MANUAL_ADJUSTMENT = 'manual_adjustment'
}

export interface CreditLedgerEntryProps {
    id: string;
    unit_id: string;
    amount: number;
    reason: string;
    reference_type: CreditLedgerReferenceType;
    reference_id: string;
    created_at?: Date;
}

export class CreditLedgerEntry {
    constructor(private props: CreditLedgerEntryProps) {
        if (!this.props.created_at) this.props.created_at = new Date();
        this.validate();
    }

    private validate() {
        if (this.props.amount === 0) {
            throw new DomainError('CreditLedgerEntry amount must not be zero', 'VALIDATION_ERROR', 400);
        }
        if (!this.props.unit_id?.trim()) {
            throw new DomainError('CreditLedgerEntry unit_id is required', 'VALIDATION_ERROR', 400);
        }
        if (!this.props.reason?.trim()) {
            throw new DomainError('CreditLedgerEntry reason is required', 'VALIDATION_ERROR', 400);
        }
        if (!this.props.reference_id?.trim()) {
            throw new DomainError('CreditLedgerEntry reference_id is required', 'VALIDATION_ERROR', 400);
        }
        if (!Object.values(CreditLedgerReferenceType).includes(this.props.reference_type)) {
            throw new DomainError(
                `CreditLedgerEntry reference_type must be one of ${Object.values(CreditLedgerReferenceType).join(', ')}`,
                'VALIDATION_ERROR',
                400
            );
        }
    }

    get id(): string { return this.props.id; }
    get unit_id(): string { return this.props.unit_id; }
    get amount(): number { return this.props.amount; }
    get reason(): string { return this.props.reason; }
    get reference_type(): CreditLedgerReferenceType { return this.props.reference_type; }
    get reference_id(): string { return this.props.reference_id; }
    get created_at(): Date { return this.props.created_at!; }

    get isCredit(): boolean { return this.props.amount > 0; }
    get isDebit(): boolean { return this.props.amount < 0; }

    /**
     * Builds a reversal entry that offsets an existing credit entry.
     * The new entry has the negated amount, REVERSAL type, and inherits
     * unit_id + reference_id from the original so audit queries can link
     * both rows through the same payment id.
     */
    static reversalOf(original: CreditLedgerEntry, reason: string): CreditLedgerEntry {
        return new CreditLedgerEntry({
            id: crypto.randomUUID(),
            unit_id: original.unit_id,
            amount: -original.amount,
            reason,
            reference_type: CreditLedgerReferenceType.REVERSAL,
            reference_id: original.reference_id
        });
    }

    toJSON(): CreditLedgerEntryProps {
        return { ...this.props };
    }
}
