import { DomainError } from '@/core/errors';

export interface DecisionQuoteProps {
    id: string;
    decision_id: string;
    uploader_user_id: string | null;
    uploader_unit_id?: string | null;
    provider_name: string;
    amount: number;
    notes?: string | null;
    file_url: string;
    deleted_at?: Date | null;
    deleted_by?: string | null;
    deletion_reason?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

export class DecisionQuote {
    constructor(private props: DecisionQuoteProps) {
        if (!props.decision_id) throw new DomainError('decision_id required', 'VALIDATION_ERROR', 400);
        if (!(props.amount > 0)) throw new DomainError('amount must be > 0', 'QUOTE_INVALID_AMOUNT', 400);
        if (!props.provider_name || props.provider_name.length < 2 || props.provider_name.length > 200) {
            throw new DomainError('provider_name length 2..200', 'VALIDATION_ERROR', 400);
        }
        if (!props.file_url) throw new DomainError('file_url required', 'VALIDATION_ERROR', 400);
        this.props.created_at ??= new Date();
        this.props.updated_at ??= new Date();
    }

    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get uploader_user_id() { return this.props.uploader_user_id; }
    get uploader_unit_id() { return this.props.uploader_unit_id ?? null; }
    get provider_name() { return this.props.provider_name; }
    get amount() { return this.props.amount; }
    get notes() { return this.props.notes ?? null; }
    get file_url() { return this.props.file_url; }
    get deleted_at() { return this.props.deleted_at ?? null; }
    get deleted_by() { return this.props.deleted_by ?? null; }
    get deletion_reason() { return this.props.deletion_reason ?? null; }
    get created_at() { return this.props.created_at!; }
    get updated_at() { return this.props.updated_at!; }
    get isDeleted() { return !!this.props.deleted_at; }

    softDelete(deletedBy: string, reason: string) {
        if (this.isDeleted) throw new DomainError('quote already deleted', 'QUOTE_DELETED', 422);
        if (!deletedBy?.trim()) throw new DomainError('deletedBy required', 'VALIDATION_ERROR', 400);
        if (!reason?.trim()) throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
        this.props.deleted_at = new Date();
        this.props.deleted_by = deletedBy;
        this.props.deletion_reason = reason;
    }

    toJSON() {
        return { ...this.props };
    }
}
