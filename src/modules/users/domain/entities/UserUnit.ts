export type UnitMembershipStatus = 'pending' | 'active' | 'rejected';

export interface UserUnitProps {
    unit_id: string;
    unit_name?: string;
    building_id?: string;
    building_name?: string;
    is_primary: boolean;
    // Per-building approval state. Defaults to 'active' for legacy rows / admin-created units.
    status?: UnitMembershipStatus;
}

export class UserUnit {
    constructor(private props: UserUnitProps) { }

    get unit_id(): string { return this.props.unit_id; }
    get unit_name(): string | undefined { return this.props.unit_name; }
    get building_id(): string | undefined { return this.props.building_id; }
    get building_name(): string | undefined { return this.props.building_name; }
    get is_primary(): boolean { return this.props.is_primary; }
    get status(): UnitMembershipStatus { return this.props.status ?? 'active'; }

    withStatus(status: UnitMembershipStatus): UserUnit {
        return new UserUnit({ ...this.props, status });
    }

    toJSON(): UserUnitProps {
        return { ...this.props, status: this.status };
    }
}
