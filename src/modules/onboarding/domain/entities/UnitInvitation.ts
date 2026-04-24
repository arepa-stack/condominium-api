export type UnitInvitationStatus = 'pending' | 'claimed' | 'expired' | 'cancelled';

export interface UnitInvitationProps {
    id: string;
    unit_id: string;
    building_id: string;
    inviter_profile_id: string;
    invitee_email: string;
    invitee_name?: string;
    token: string;
    status: UnitInvitationStatus;
    expires_at: Date;
    claimed_at?: Date;
    created_at: Date;
}

export class UnitInvitation {
    constructor(private props: UnitInvitationProps) {}

    get id(): string { return this.props.id; }
    get unit_id(): string { return this.props.unit_id; }
    get building_id(): string { return this.props.building_id; }
    get inviter_profile_id(): string { return this.props.inviter_profile_id; }
    get invitee_email(): string { return this.props.invitee_email; }
    get invitee_name(): string | undefined { return this.props.invitee_name; }
    get token(): string { return this.props.token; }
    get status(): UnitInvitationStatus { return this.props.status; }
    get expires_at(): Date { return this.props.expires_at; }
    get claimed_at(): Date | undefined { return this.props.claimed_at; }
    get created_at(): Date { return this.props.created_at; }

    isPending(): boolean { return this.props.status === 'pending'; }
    isExpired(): boolean { return this.props.expires_at < new Date(); }
    isUsable(): boolean { return this.isPending() && !this.isExpired(); }

    claim(): void {
        this.props.status = 'claimed';
        this.props.claimed_at = new Date();
    }

    cancel(): void {
        this.props.status = 'cancelled';
    }

    toJSON(): UnitInvitationProps {
        return { ...this.props };
    }
}
