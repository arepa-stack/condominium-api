import { DomainError } from '@/core/errors';

export enum DecisionStatus {
    RECEPTION = 'RECEPTION',
    VOTING = 'VOTING',
    TIEBREAK_PENDING = 'TIEBREAK_PENDING',
    RESOLVED = 'RESOLVED',
    CANCELLED = 'CANCELLED',
}

export enum DecisionProcessType {
    VOTING = 'VOTING',
    DIRECT_AWARD = 'DIRECT_AWARD',
}

export type DecisionResultingType = 'INVOICE' | 'ASSESSMENT';

export interface ProfileRef {
    id: string;
    name: string;
}

export interface DecisionProps {
    id: string;
    building_id: string;
    created_by: string | null;
    title: string;
    description?: string | null;
    photo_url?: string | null;
    status?: DecisionStatus;
    process_type?: DecisionProcessType;
    current_round?: number;
    reception_deadline: Date;
    voting_deadline: Date;
    tiebreak_duration_hours?: number;
    winner_quote_id?: string | null;
    resulting_type?: DecisionResultingType | null;
    resulting_id?: string | null;
    finalized_at?: Date | null;
    cancelled_at?: Date | null;
    cancel_reason?: string | null;
    created_at?: Date;
    updated_at?: Date;
    // Hydrated by repo joins / computed. Not persisted.
    creator?: ProfileRef | null;
    quote_count?: number;
}

export class Decision {
    constructor(private props: DecisionProps) {
        if (!props.building_id) {
            throw new DomainError('building_id required', 'VALIDATION_ERROR', 400);
        }
        if (!props.title || props.title.length < 5 || props.title.length > 200) {
            throw new DomainError('title must be 5..200 chars', 'VALIDATION_ERROR', 400);
        }
        if (props.voting_deadline.getTime() <= props.reception_deadline.getTime()) {
            throw new DomainError(
                'voting_deadline must be after reception_deadline',
                'DECISION_INVALID_DEADLINES',
                400,
            );
        }
        if (
            props.tiebreak_duration_hours !== undefined &&
            (props.tiebreak_duration_hours < 1 || props.tiebreak_duration_hours > 720)
        ) {
            throw new DomainError(
                'tiebreak_duration_hours must be between 1 and 720',
                'VALIDATION_ERROR',
                400,
            );
        }

        this.props.status ??= DecisionStatus.RECEPTION;
        this.props.process_type ??= DecisionProcessType.VOTING;
        this.props.current_round ??= 1;
        this.props.tiebreak_duration_hours ??= 48;
        this.props.created_at ??= new Date();
        this.props.updated_at ??= new Date();
    }

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get created_by(): string | null { return this.props.created_by; }
    get creator(): ProfileRef | null { return this.props.creator ?? null; }
    get title(): string { return this.props.title; }
    get description(): string | null { return this.props.description ?? null; }
    get photo_url(): string | null { return this.props.photo_url ?? null; }
    get status(): DecisionStatus { return this.props.status!; }
    get process_type(): DecisionProcessType { return this.props.process_type!; }
    get current_round(): number { return this.props.current_round!; }
    get reception_deadline(): Date { return this.props.reception_deadline; }
    get voting_deadline(): Date { return this.props.voting_deadline; }
    get tiebreak_duration_hours(): number { return this.props.tiebreak_duration_hours!; }
    get winner_quote_id(): string | null { return this.props.winner_quote_id ?? null; }
    get resulting_type(): DecisionResultingType | null { return this.props.resulting_type ?? null; }
    get resulting_id(): string | null { return this.props.resulting_id ?? null; }
    get finalized_at(): Date | null { return this.props.finalized_at ?? null; }
    get cancelled_at(): Date | null { return this.props.cancelled_at ?? null; }
    get cancel_reason(): string | null { return this.props.cancel_reason ?? null; }
    get created_at(): Date { return this.props.created_at!; }
    get updated_at(): Date { return this.props.updated_at!; }
    get quote_count(): number { return this.props.quote_count ?? 0; }

    /**
     * Deadline-driven finalize eligibility. True when the current phase's
     * deadline has passed and a manual finalize call would advance state.
     * Terminal and manual-pending statuses are never "deadline_passed".
     */
    get is_deadline_passed(): boolean {
        const now = Date.now();
        if (this.status === DecisionStatus.RECEPTION) {
            return this.reception_deadline.getTime() <= now;
        }
        if (this.status === DecisionStatus.VOTING) {
            return this.voting_deadline.getTime() <= now;
        }
        return false;
    }

    /**
     * Advances RECEPTION → VOTING. By default the reception deadline must have
     * passed. Passing `{ force: true }` (admin/board override) bypasses the
     * deadline check — the caller is responsible for justifying this in the
     * audit log (e.g. "all residents confirmed quotes submitted").
     */
    advanceToVoting(opts: { force?: boolean } = {}): void {
        if (this.status !== DecisionStatus.RECEPTION) {
            throw new DomainError('decision is not in RECEPTION', 'DECISION_WRONG_STATUS', 422);
        }
        if (!opts.force && this.reception_deadline.getTime() > Date.now()) {
            throw new DomainError(
                'reception_deadline not yet passed',
                'DECISION_DEADLINE_NOT_YET_PASSED',
                422,
            );
        }
        this.props.status = DecisionStatus.VOTING;
    }

    resolve(winnerQuoteId: string): void {
        if (!winnerQuoteId?.trim()) {
            throw new DomainError('winnerQuoteId required', 'VALIDATION_ERROR', 400);
        }
        if (this.status !== DecisionStatus.VOTING && this.status !== DecisionStatus.TIEBREAK_PENDING) {
            throw new DomainError(
                'decision is not in VOTING/TIEBREAK_PENDING',
                'DECISION_WRONG_STATUS',
                422,
            );
        }
        this.completeResolution(winnerQuoteId);
    }

    /**
     * Resolves a decision during quote reception when voting would add no
     * value because there is a single provider. The application use case is
     * responsible for verifying that exactly one active quote exists.
     */
    awardDirectly(winnerQuoteId: string): void {
        if (!winnerQuoteId?.trim()) {
            throw new DomainError('winnerQuoteId required', 'VALIDATION_ERROR', 400);
        }
        if (this.status !== DecisionStatus.RECEPTION) {
            throw new DomainError(
                'direct award is only allowed in RECEPTION',
                'DECISION_WRONG_STATUS',
                422,
            );
        }
        this.props.process_type = DecisionProcessType.DIRECT_AWARD;
        this.completeResolution(winnerQuoteId);
    }

    private completeResolution(winnerQuoteId: string): void {
        this.props.status = DecisionStatus.RESOLVED;
        this.props.winner_quote_id = winnerQuoteId;
        this.props.finalized_at = new Date();
    }

    openTiebreak(): void {
        if (this.status !== DecisionStatus.VOTING) {
            throw new DomainError('tiebreak only from VOTING', 'DECISION_WRONG_STATUS', 422);
        }
        this.props.current_round = this.current_round + 1;
        this.props.voting_deadline = new Date(Date.now() + this.tiebreak_duration_hours * 3_600_000);
        // status stays VOTING for the new round
    }

    markTiebreakPendingManual(): void {
        if (this.status !== DecisionStatus.VOTING) {
            throw new DomainError('only from VOTING', 'DECISION_WRONG_STATUS', 422);
        }
        this.props.status = DecisionStatus.TIEBREAK_PENDING;
    }

    cancel(reason: string): void {
        if (this.status === DecisionStatus.RESOLVED || this.status === DecisionStatus.CANCELLED) {
            throw new DomainError('cannot cancel terminal decision', 'DECISION_WRONG_STATUS', 422);
        }
        if (!reason?.trim()) {
            throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
        }
        this.props.status = DecisionStatus.CANCELLED;
        this.props.cancelled_at = new Date();
        this.props.cancel_reason = reason;
    }

    extendDeadlines(input: { reception_deadline?: Date; voting_deadline?: Date }): void {
        if (this.status !== DecisionStatus.RECEPTION && this.status !== DecisionStatus.VOTING) {
            throw new DomainError('cannot extend in current status', 'DECISION_WRONG_STATUS', 422);
        }
        if (this.status === DecisionStatus.VOTING && input.reception_deadline) {
            throw new DomainError(
                'cannot extend reception_deadline in VOTING phase',
                'DECISION_WRONG_STATUS',
                422,
            );
        }
        const reception = input.reception_deadline ?? this.reception_deadline;
        const voting = input.voting_deadline ?? this.voting_deadline;
        if (voting.getTime() <= reception.getTime()) {
            throw new DomainError(
                'voting_deadline must be after reception_deadline',
                'DECISION_INVALID_DEADLINES',
                400,
            );
        }
        // Only validate past-check for deadlines that were actually provided in the input
        const now = Date.now();
        if (input.reception_deadline && input.reception_deadline.getTime() < now) {
            throw new DomainError('reception_deadline cannot be in the past', 'DECISION_INVALID_DEADLINES', 400);
        }
        if (input.voting_deadline && input.voting_deadline.getTime() < now) {
            throw new DomainError('voting_deadline cannot be in the past', 'DECISION_INVALID_DEADLINES', 400);
        }
        this.props.reception_deadline = reception;
        this.props.voting_deadline = voting;
    }

    attachCharge(type: DecisionResultingType, id: string): void {
        if (this.status !== DecisionStatus.RESOLVED) {
            throw new DomainError('charge requires RESOLVED', 'DECISION_WRONG_STATUS', 422);
        }
        if (this.props.resulting_id) {
            throw new DomainError('decision already charged', 'DECISION_ALREADY_CHARGED', 409);
        }
        this.props.resulting_type = type;
        this.props.resulting_id = id;
    }

    updatePhoto(photo_url: string | null): void {
        this.props.photo_url = photo_url;
        this.props.updated_at = new Date();
    }

    /**
     * Wire-format DTO. photo_url is the stored path here — the presentation
     * layer re-signs it with a short TTL before returning to the client.
     * Per spec §6.4: created_by is expanded as { id, name } | null.
     */
    toJSON() {
        return {
            id: this.id,
            building_id: this.building_id,
            created_by: this.creator,
            title: this.title,
            description: this.description,
            photo_url: this.photo_url,
            status: this.status,
            process_type: this.process_type,
            current_round: this.current_round,
            reception_deadline: this.reception_deadline.toISOString(),
            voting_deadline: this.voting_deadline.toISOString(),
            tiebreak_duration_hours: this.tiebreak_duration_hours,
            winner_quote_id: this.winner_quote_id,
            resulting_type: this.resulting_type,
            resulting_id: this.resulting_id,
            finalized_at: this.finalized_at?.toISOString() ?? null,
            cancelled_at: this.cancelled_at?.toISOString() ?? null,
            cancel_reason: this.cancel_reason,
            created_at: this.created_at.toISOString(),
            updated_at: this.updated_at.toISOString(),
            quote_count: this.quote_count,
            is_deadline_passed: this.is_deadline_passed,
        };
    }
}
