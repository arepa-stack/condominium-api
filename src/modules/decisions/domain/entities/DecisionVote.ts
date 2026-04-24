import { DomainError } from '@/core/errors';
import type { ProfileRef } from './Decision';

export interface DecisionVoteProps {
    id: string;
    decision_id: string;
    round: number;
    apartment_id: string;
    quote_id: string;
    voted_by_user_id: string | null;
    created_at?: Date;
    // Hydrated by repo joins. Not persisted.
    voted_by?: ProfileRef | null;
}

export class DecisionVote {
    constructor(private props: DecisionVoteProps) {
        if (!props.decision_id?.trim()) throw new DomainError('decision_id required', 'VALIDATION_ERROR', 400);
        if (!(props.round >= 1)) throw new DomainError('round must be >= 1', 'VALIDATION_ERROR', 400);
        if (!props.apartment_id?.trim()) throw new DomainError('apartment_id required', 'VALIDATION_ERROR', 400);
        if (!props.quote_id?.trim()) throw new DomainError('quote_id required', 'VALIDATION_ERROR', 400);
        this.props.created_at ??= new Date();
    }

    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get round() { return this.props.round; }
    get apartment_id() { return this.props.apartment_id; }
    get quote_id() { return this.props.quote_id; }
    get voted_by_user_id() { return this.props.voted_by_user_id; }
    get voted_by(): ProfileRef | null { return this.props.voted_by ?? null; }
    get created_at() { return this.props.created_at!; }

    /** Wire-format DTO. Per spec §6.4: voted_by is { id, name } | null. */
    toJSON() {
        return {
            id: this.id,
            decision_id: this.decision_id,
            round: this.round,
            apartment_id: this.apartment_id,
            quote_id: this.quote_id,
            voted_by: this.voted_by,
            created_at: this.created_at.toISOString(),
        };
    }
}
