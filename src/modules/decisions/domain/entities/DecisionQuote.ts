import { DomainError } from '@/core/errors';
import type { ProfileRef } from './Decision';

export interface DecisionQuoteProps {
    id: string;
    decision_id: string;
    uploader_user_id: string | null;
    uploader_unit_id?: string | null;
    provider_name: string;
    amount: number;
    notes?: string | null;
    file_url?: string | null;
    deleted_at?: Date | null;
    deleted_by?: string | null;
    deletion_reason?: string | null;
    created_at?: Date;
    updated_at?: Date;
    // Hydrated by repo joins. Not persisted.
    uploader?: ProfileRef | null;
    deleter?: ProfileRef | null;
}

export class DecisionQuote {
    constructor(private props: DecisionQuoteProps) {
        if (!props.decision_id?.trim()) throw new DomainError('decision_id required', 'VALIDATION_ERROR', 400);
        if (!(props.amount > 0)) throw new DomainError('amount must be > 0', 'QUOTE_INVALID_AMOUNT', 400);
        const name = props.provider_name?.trim() ?? '';
        if (name.length < 2 || name.length > 200) {
            throw new DomainError('provider_name length 2..200', 'VALIDATION_ERROR', 400);
        }
        if (props.file_url != null && !props.file_url.trim()) {
            throw new DomainError('file_url cannot be blank', 'VALIDATION_ERROR', 400);
        }
        this.props.created_at ??= new Date();
        this.props.updated_at ??= new Date();
    }

    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get uploader_user_id() { return this.props.uploader_user_id; }
    get uploader_unit_id() { return this.props.uploader_unit_id ?? null; }
    get uploader(): ProfileRef | null { return this.props.uploader ?? null; }
    get provider_name() { return this.props.provider_name; }
    get amount() { return this.props.amount; }
    get notes() { return this.props.notes ?? null; }
    get file_url(): string | null { return this.props.file_url ?? null; }
    get deleted_at() { return this.props.deleted_at ?? null; }
    get deleted_by() { return this.props.deleted_by ?? null; }
    get deleter(): ProfileRef | null { return this.props.deleter ?? null; }
    get deletion_reason() { return this.props.deletion_reason ?? null; }
    get created_at() { return this.props.created_at!; }
    get updated_at() { return this.props.updated_at!; }
    get isDeleted() { return !!this.props.deleted_at; }

    softDelete(deletedBy: string, reason: string) {
        if (!deletedBy?.trim()) throw new DomainError('deletedBy required', 'VALIDATION_ERROR', 400);
        if (!reason?.trim()) throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
        if (this.isDeleted) throw new DomainError('quote already deleted', 'QUOTE_DELETED', 422);
        this.props.deleted_at = new Date();
        this.props.deleted_by = deletedBy;
        this.props.deletion_reason = reason;
    }

    /**
     * Wire-format DTO. file_url is the stored path, or null when a direct quote
     * has no attachment. The presentation layer re-signs stored paths.
     */
    toJSON() {
        return {
            id: this.id,
            decision_id: this.decision_id,
            uploader: this.uploader,
            uploader_unit_id: this.uploader_unit_id,
            provider_name: this.provider_name,
            amount: this.amount,
            notes: this.notes,
            file_url: this.file_url,
            deleted_at: this.deleted_at?.toISOString() ?? null,
            deleted_by: this.deleter,
            deletion_reason: this.deletion_reason,
            created_at: this.created_at.toISOString(),
            updated_at: this.updated_at.toISOString(),
        };
    }
}
