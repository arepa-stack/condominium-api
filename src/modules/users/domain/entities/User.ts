import { UserStatus, AppRole } from '@/core/domain/enums';

import { UserUnit } from './UserUnit';
import { BuildingRole } from './BuildingRole';

export type UserSource = 'qr' | 'invitation' | 'admin';

export interface UserProps {
    id: string;
    email: string;
    name: string;
    phone?: string;
    document_id?: string;
    source?: UserSource;
    units?: UserUnit[];
    buildingRoles?: BuildingRole[];
    app_role: AppRole;  // Global capability. 'admin' | 'user'.
    status: UserStatus;
    must_change_password?: boolean;
    created_at?: Date;
    updated_at?: Date;
}

/**
 * A user of the platform.
 *
 * Role model (post Phase 4):
 *   - app_role          : global capability — 'admin' or 'user' (only 'admin' is
 *                         privileged globally).
 *   - buildingRoles[]   : per-building governance roles (today only 'board').
 *                         Source: building_members table.
 *   - units[]           : per-unit ownership/occupancy. Having a unit in a
 *                         building implies the user is a resident there, but
 *                         carries no governance authority.
 *
 * Effective role for legacy callers is *derived* — this entity no longer
 * stores 'board' or 'resident' as a global value.
 */
export class User {
    constructor(private props: UserProps) {
        if (!props.created_at) {
            this.props.created_at = new Date();
        }
        if (!props.updated_at) {
            this.props.updated_at = new Date();
        }
        if (!props.units) {
            this.props.units = [];
        }
        if (!props.buildingRoles) {
            this.props.buildingRoles = [];
        }
    }

    get id(): string { return this.props.id; }
    get email(): string { return this.props.email; }
    get name(): string { return this.props.name; }
    get phone(): string | undefined { return this.props.phone; }
    get document_id(): string | undefined { return this.props.document_id; }
    get source(): UserSource { return this.props.source ?? 'admin'; }

    get units(): UserUnit[] { return this.props.units || []; }
    get buildingRoles(): BuildingRole[] { return this.props.buildingRoles || []; }

    get primaryUnitId(): string | undefined {
        return this.primaryUnit?.unit_id || this.units[0]?.unit_id;
    }

    get app_role(): AppRole { return this.props.app_role; }
    get status(): UserStatus { return this.props.status; }
    get must_change_password(): boolean { return this.props.must_change_password ?? false; }
    get created_at(): Date { return this.props.created_at!; }
    get updated_at(): Date { return this.props.updated_at!; }

    get primaryUnit(): UserUnit | undefined {
        return this.units.find(u => u.is_primary);
    }

    /**
     * Semantics:
     *  - isAdmin           : global capability via app_role.
     *  - isBoardMember     : has a board role in any building.
     *  - isResident        : complement — neither admin nor board anywhere.
     *
     * A user can be board in building A and resident in building B; use
     * isBoardInBuilding(id) for per-building questions.
     */
    isAdmin(): boolean {
        return this.app_role === 'admin';
    }

    isBoardMember(): boolean {
        return this.isBoardMemberAnywhere();
    }

    isResident(): boolean {
        return !this.isAdmin() && !this.isBoardMemberAnywhere();
    }

    clearPasswordChangeFlag(): void {
        this.props.must_change_password = false;
        this.props.updated_at = new Date();
    }

    approve(): void {
        if (this.props.status === UserStatus.ACTIVE) return;
        this.props.status = UserStatus.ACTIVE;
        this.props.updated_at = new Date();
    }

    reject(): void {
        this.props.status = UserStatus.REJECTED;
        this.props.updated_at = new Date();
    }

    isActive(): boolean {
        return this.props.status === UserStatus.ACTIVE;
    }

    updateProfile(data: Partial<Omit<UserProps, 'id' | 'email' | 'app_role' | 'status' | 'created_at' | 'updated_at' | 'units' | 'buildingRoles'>>): void {
        this.props = {
            ...this.props,
            ...data,
            updated_at: new Date()
        };
    }

    /**
     * Change the user's global capability. Only ADMIN callers should be able
     * to invoke this — enforcement lives at the use-case layer (UpdateUser).
     */
    changeAppRole(newAppRole: AppRole): void {
        this.props.app_role = newAppRole;
        this.props.updated_at = new Date();
    }

    setUnits(units: UserUnit[]) {
        this.props.units = units;
        this.props.updated_at = new Date();
    }

    setBuildingRoles(roles: BuildingRole[]) {
        this.props.buildingRoles = roles;
        this.props.updated_at = new Date();
    }

    /**
     * Check if user is board member in a specific building
     */
    isBoardInBuilding(buildingId: string): boolean {
        return this.buildingRoles.some(r =>
            r.building_id === buildingId && r.isBoardMember()
        );
    }

    /**
     * Get all buildings where user is board.
     * Requester-side scoping: "where may this user govern?".
     */
    getBuildingsWhereBoard(): string[] {
        const buildingIds = this.buildingRoles
            .filter(r => r.isBoardMember())
            .map(r => r.building_id)
            .filter(Boolean);
        return Array.from(new Set(buildingIds));
    }

    /**
     * Check if user has any board role in any building
     */
    isBoardMemberAnywhere(): boolean {
        return this.buildingRoles.some(r => r.isBoardMember());
    }

    /**
     * Every building this user is affiliated with: either owns/occupies a unit
     * there OR holds a board role there. Target-side reachability ("can this
     * board see this other user?" — yes if the target is affiliated with any
     * building the requester governs, even if via a role rather than a unit).
     *
     * NOT to be used for requester-side authority checks — use
     * getBuildingsWhereBoard() for that.
     */
    getAffiliatedBuildings(): string[] {
        const ids = new Set<string>();
        for (const u of this.units) {
            if (u.building_id) ids.add(u.building_id);
        }
        for (const r of this.buildingRoles) {
            if (r.building_id) ids.add(r.building_id);
        }
        return Array.from(ids);
    }

    toJSON(): UserProps {
        return {
            ...this.props,
            units: this.units.map(u => u.toJSON()),
            buildingRoles: this.buildingRoles.map(r => r.toJSON())
        } as any;
    }

    toString(): string {
        return JSON.stringify(this.toJSON());
    }
}
