import { PaymentStatus, PaymentMethod } from '@/core/domain/enums';
import type { RateSource } from '@/core/domain/ports/IExchangeRateService';

export type PaymentCurrency = 'USD' | 'VES';

export interface PaymentProps {
    id: string;
    user_id: string;
    building_id?: string | null;
    // Canonical amount in the building's base unit. Allocation/approval use this.
    amount: number;
    // Currency the resident actually paid in, and the rate applied when VES.
    original_currency?: PaymentCurrency;
    original_amount?: number | null;
    exchange_rate?: number | null;
    rate_source?: RateSource | null;
    rate_date?: string | null;
    payment_date: Date;
    method: PaymentMethod;
    reference?: string | null;
    bank?: string | null;
    proof_url?: string | null;
    status: PaymentStatus;
    unit_id: string;
    notes?: string | null;
    processed_by?: string | null; // profile_id of the person who approved/rejected
    processed_at?: Date | null;
    created_at?: Date;
    updated_at?: Date;
    user?: {
        id: string;
        name: string;
    };
    processor?: {
        id: string;
        name: string;
    };
}

export class Payment {
    constructor(private props: PaymentProps) {
        if (!props.created_at) {
            this.props.created_at = new Date();
        }
        if (!props.updated_at) {
            this.props.updated_at = new Date();
        }
    }

    get id(): string { return this.props.id; }
    get user_id(): string { return this.props.user_id; }
    get building_id(): string | undefined | null { return this.props.building_id; }
    get amount(): number { return this.props.amount; }
    get original_currency(): PaymentCurrency { return this.props.original_currency ?? 'USD'; }
    get original_amount(): number | null | undefined { return this.props.original_amount; }
    get exchange_rate(): number | null | undefined { return this.props.exchange_rate; }
    get rate_source(): RateSource | null | undefined { return this.props.rate_source; }
    get rate_date(): string | null | undefined { return this.props.rate_date; }
    get payment_date(): Date { return this.props.payment_date; }
    get method(): PaymentMethod { return this.props.method; }
    get reference(): string | undefined | null { return this.props.reference; }
    get bank(): string | undefined | null { return this.props.bank; }
    get proof_url(): string | undefined | null { return this.props.proof_url; }
    get status(): PaymentStatus { return this.props.status; }
    get unit_id(): string { return this.props.unit_id; }
    get notes(): string | undefined | null { return this.props.notes; }
    get processed_by(): string | undefined | null { return this.props.processed_by; }
    get processed_at(): Date | undefined | null { return this.props.processed_at; }
    get created_at(): Date { return this.props.created_at!; }
    get updated_at(): Date { return this.props.updated_at!; }
    get user(): { id: string, name: string } | undefined { return this.props.user; }
    get processor(): { id: string, name: string } | undefined { return this.props.processor; }

    isPending(): boolean {
        return this.props.status === PaymentStatus.PENDING;
    }

    isApproved(): boolean {
        return this.props.status === PaymentStatus.APPROVED;
    }

    isRejected(): boolean {
        return this.props.status === PaymentStatus.REJECTED;
    }

    approve(processorId: string, notes?: string): void {
        if (this.props.status === PaymentStatus.APPROVED) return;
        this.props.status = PaymentStatus.APPROVED;
        this.props.processed_by = processorId;
        this.props.processed_at = new Date();
        if (notes) this.props.notes = notes;
        this.props.updated_at = new Date();
    }

    reject(processorId: string, notes?: string): void {
        if (this.props.status === PaymentStatus.REJECTED) return;
        this.props.status = PaymentStatus.REJECTED;
        this.props.processed_by = processorId;
        this.props.processed_at = new Date();
        if (notes) this.props.notes = notes;
        this.props.updated_at = new Date();
    }

    updateNotes(notes: string): void {
        this.props.notes = notes;
        this.props.updated_at = new Date();
    }

    toJSON(): PaymentProps {
        return this.props;
    }

    toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
