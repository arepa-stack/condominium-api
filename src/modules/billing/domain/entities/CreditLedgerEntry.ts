import { DomainError } from '../../../../core/errors';

export interface CreditLedgerEntryProps {
    id: string;
    unit_id: string;
    amount: number;
    reason: string;
    reference_type: string;
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
    }

    get id(): string { return this.props.id; }
    get unit_id(): string { return this.props.unit_id; }
    get amount(): number { return this.props.amount; }
    get reason(): string { return this.props.reason; }
    get reference_type(): string { return this.props.reference_type; }
    get reference_id(): string { return this.props.reference_id; }
    get created_at(): Date { return this.props.created_at!; }

    toJSON(): CreditLedgerEntryProps {
        return { ...this.props };
    }
}
