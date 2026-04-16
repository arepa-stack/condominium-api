export interface BoardMemberProps {
    member_id: string;
    role: string;
    building_id: string;
    profile: {
        id: string;
        name: string;
        email: string;
        phone?: string;
    };
    unit?: {
        id: string;
        name: string;
    };
}

export class BoardMember {
    constructor(private props: BoardMemberProps) {}

    get id() { return this.props.member_id; }
    get role() { return this.props.role; }
    get buildingId() { return this.props.building_id; }
    get profile() { return this.props.profile; }
    get unit() { return this.props.unit; }

    toJSON() {
        return {
            member_id: this.props.member_id,
            role: this.props.role,
            building_id: this.props.building_id,
            profile: this.props.profile,
            unit: this.props.unit
        };
    }
}
