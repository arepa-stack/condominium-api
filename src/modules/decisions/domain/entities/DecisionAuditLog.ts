import { DomainError } from '@/core/errors';

export enum AuditEvent {
    CREATED = 'CREATED',
    DEADLINE_EXTENDED = 'DEADLINE_EXTENDED',
    CANCELLED = 'CANCELLED',
    QUOTE_DELETED = 'QUOTE_DELETED',
    FINALIZED = 'FINALIZED',
    TIEBREAK_OPENED = 'TIEBREAK_OPENED',
    WINNER_SET_MANUAL = 'WINNER_SET_MANUAL',
    CHARGE_GENERATED = 'CHARGE_GENERATED',
    PHASE_ADVANCED = 'PHASE_ADVANCED',
}

export interface DecisionAuditLogProps {
    id: string;
    decision_id: string;
    event: AuditEvent;
    actor_user_id: string | null;
    payload: Record<string, unknown> | null;
    created_at?: Date;
}

export class DecisionAuditLog {
    constructor(private props: DecisionAuditLogProps) {
        if (!props.decision_id?.trim()) throw new DomainError('decision_id required', 'VALIDATION_ERROR', 400);
        if (!Object.values(AuditEvent).includes(props.event)) {
            throw new DomainError('invalid audit event', 'VALIDATION_ERROR', 400);
        }
        this.props.created_at ??= new Date();
    }

    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get event() { return this.props.event; }
    get actor_user_id() { return this.props.actor_user_id; }
    get payload() { return this.props.payload; }
    get created_at() { return this.props.created_at!; }

    toJSON() {
        return {
            id: this.id,
            decision_id: this.decision_id,
            event: this.event,
            actor_user_id: this.actor_user_id,
            payload: this.payload,
            created_at: this.created_at,
        };
    }
}
