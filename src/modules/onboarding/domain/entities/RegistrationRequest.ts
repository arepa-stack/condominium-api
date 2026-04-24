export type RegistrationRequestSource = 'qr' | 'invitation';
export type RegistrationRequestStatus = 'pending' | 'approved' | 'rejected';

export interface RegistrationRequestProps {
    id: string;
    building_id: string;
    unit_id: string;
    email: string;
    first_name: string;
    last_name: string;
    document_id: string;
    phone?: string;
    source: RegistrationRequestSource;
    invited_by_profile_id?: string;
    invitation_id?: string;
    status: RegistrationRequestStatus;
    created_profile_id?: string;
    reviewed_by_profile_id?: string;
    reviewed_at?: Date;
    rejection_reason?: string;
    created_at: Date;
}

export class RegistrationRequest {
    constructor(private props: RegistrationRequestProps) {}

    get id(): string { return this.props.id; }
    get building_id(): string { return this.props.building_id; }
    get unit_id(): string { return this.props.unit_id; }
    get email(): string { return this.props.email; }
    get first_name(): string { return this.props.first_name; }
    get last_name(): string { return this.props.last_name; }
    get full_name(): string { return `${this.props.first_name} ${this.props.last_name}`; }
    get document_id(): string { return this.props.document_id; }
    get phone(): string | undefined { return this.props.phone; }
    get source(): RegistrationRequestSource { return this.props.source; }
    get invited_by_profile_id(): string | undefined { return this.props.invited_by_profile_id; }
    get invitation_id(): string | undefined { return this.props.invitation_id; }
    get status(): RegistrationRequestStatus { return this.props.status; }
    get created_profile_id(): string | undefined { return this.props.created_profile_id; }
    get reviewed_by_profile_id(): string | undefined { return this.props.reviewed_by_profile_id; }
    get reviewed_at(): Date | undefined { return this.props.reviewed_at; }
    get rejection_reason(): string | undefined { return this.props.rejection_reason; }
    get created_at(): Date { return this.props.created_at; }

    isPending(): boolean { return this.props.status === 'pending'; }

    approve(reviewerId: string, createdProfileId: string): void {
        this.props.status = 'approved';
        this.props.reviewed_by_profile_id = reviewerId;
        this.props.reviewed_at = new Date();
        this.props.created_profile_id = createdProfileId;
    }

    reject(reviewerId: string, reason?: string): void {
        this.props.status = 'rejected';
        this.props.reviewed_by_profile_id = reviewerId;
        this.props.reviewed_at = new Date();
        this.props.rejection_reason = reason;
    }

    toJSON(): RegistrationRequestProps {
        return { ...this.props };
    }
}
