import { DomainError } from '../../../../core/errors';
import { InvoiceTag } from '../../../../core/domain/enums';

export { InvoiceTag };

export enum InvoiceStatus {
    PENDING = 'PENDING',
    PARTIAL = 'PARTIAL',
    PAID = 'PAID',
    CANCELLED = 'CANCELLED'
}

export enum InvoiceType {
    EXPENSE = 'EXPENSE',
    DEBT = 'DEBT',
    EXTRAORDINARY = 'EXTRAORDINARY',
    /** @deprecated Replenishment flow replaced by credit ledger. Do not use for new invoices. */
    PETTY_CASH_REPLENISHMENT = 'PETTY_CASH_REPLENISHMENT'
}

export interface InvoiceProps {
    id: string;
    unit_id?: string;
    building_id?: string;
    amount: number;
    period: string;
    issue_date: Date;
    due_date?: Date;
    status: InvoiceStatus;
    type: InvoiceType;
    tag?: InvoiceTag;
    description?: string;
    receipt_number?: string;
    paid_amount?: number;
    created_at?: Date;
    updated_at?: Date;
}

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
    [InvoiceStatus.PENDING]: [InvoiceStatus.PARTIAL, InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
    [InvoiceStatus.PARTIAL]: [InvoiceStatus.PENDING, InvoiceStatus.PAID, InvoiceStatus.CANCELLED],
    [InvoiceStatus.PAID]: [InvoiceStatus.PARTIAL, InvoiceStatus.PENDING],
    [InvoiceStatus.CANCELLED]: []
};

export class Invoice {
    constructor(private props: InvoiceProps) {
        if (!this.props.tag) this.props.tag = InvoiceTag.NORMAL;
        this.validate();
        if (!this.props.created_at) this.props.created_at = new Date();
        if (!this.props.updated_at) this.props.updated_at = new Date();
    }

    private validate() {
        if (this.props.amount < 0) {
            throw new DomainError('Invoice amount cannot be negative', 'VALIDATION_ERROR', 400);
        }
        if (!this.props.period) {
            throw new DomainError('Invoice period is required', 'VALIDATION_ERROR', 400);
        }
        if (!this.props.unit_id && !this.props.building_id) {
            throw new DomainError('Invoice must have at least unit_id or building_id', 'VALIDATION_ERROR', 400);
        }
    }

    private assertCanTransitionTo(next: InvoiceStatus): void {
        const current = this.props.status;
        if (current === next) return;
        const allowed = ALLOWED_TRANSITIONS[current] ?? [];
        if (!allowed.includes(next)) {
            throw new DomainError(
                `Invalid invoice status transition: ${current} -> ${next}`,
                'INVALID_STATE_TRANSITION',
                409
            );
        }
    }

    get id(): string { return this.props.id; }
    get unit_id(): string | undefined { return this.props.unit_id; }
    get building_id(): string | undefined { return this.props.building_id; }
    get amount(): number { return this.props.amount; }
    get period(): string { return this.props.period; }
    get issue_date(): Date { return this.props.issue_date; }
    get due_date(): Date | undefined { return this.props.due_date; }
    get status(): InvoiceStatus { return this.props.status; }
    get type(): InvoiceType { return this.props.type; }
    get tag(): InvoiceTag { return this.props.tag!; }
    get description(): string | undefined { return this.props.description; }
    get receipt_number(): string | undefined { return this.props.receipt_number; }
    get paid_amount(): number { return this.props.paid_amount || 0; }
    get created_at(): Date { return this.props.created_at!; }
    get updated_at(): Date { return this.props.updated_at!; }

    get remainingBalance(): number {
        return Math.max(0, this.props.amount - this.paid_amount);
    }

    isPaid(): boolean {
        return this.props.status === InvoiceStatus.PAID;
    }

    addPayment(amount: number): void {
        if (amount <= 0) {
            throw new DomainError('addPayment amount must be positive', 'VALIDATION_ERROR', 400);
        }
        const next = this.paid_amount + amount;
        if (next > this.amount) {
            throw new DomainError(
                `addPayment would exceed invoice amount: ${next} > ${this.amount}. ` +
                `The caller must route the excess to the credit ledger, not force it onto the invoice.`,
                'VALIDATION_ERROR',
                400
            );
        }
        this.props.paid_amount = next;
        this.props.updated_at = new Date();
    }

    subtractPayment(amount: number): void {
        if (amount <= 0) {
            throw new DomainError('subtractPayment amount must be positive', 'VALIDATION_ERROR', 400);
        }
        this.props.paid_amount = Math.max(0, this.paid_amount - amount);
        this.props.updated_at = new Date();
    }

    markAsPaid(): void {
        this.assertCanTransitionTo(InvoiceStatus.PAID);
        this.props.status = InvoiceStatus.PAID;
        this.props.updated_at = new Date();
    }

    markAsPartial(): void {
        this.assertCanTransitionTo(InvoiceStatus.PARTIAL);
        this.props.status = InvoiceStatus.PARTIAL;
        this.props.updated_at = new Date();
    }

    updateStatus(): void {
        let next: InvoiceStatus;
        if (this.paid_amount >= this.amount) {
            next = InvoiceStatus.PAID;
        } else if (this.paid_amount > 0) {
            next = InvoiceStatus.PARTIAL;
        } else {
            next = InvoiceStatus.PENDING;
        }
        this.assertCanTransitionTo(next);
        this.props.status = next;
        this.props.updated_at = new Date();
    }

    cancel(): void {
        this.assertCanTransitionTo(InvoiceStatus.CANCELLED);
        this.props.status = InvoiceStatus.CANCELLED;
        this.props.updated_at = new Date();
    }

    toJSON(): InvoiceProps {
        return { ...this.props };
    }
}
