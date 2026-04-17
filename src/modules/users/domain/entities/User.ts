import { UserRole, UserStatus, AppRole } from '@/core/domain/enums';
import { DomainError } from '@/core/errors';

import { UserUnit } from './UserUnit';
import { BuildingRole } from './BuildingRole';

export interface UserProps {
    id: string;
    email: string;
    name: string;
    phone?: string;
    units?: UserUnit[];
    buildingRoles?: BuildingRole[]; // New building-level roles support
    role: UserRole;         // Legacy — dropped in phase 4. Kept for RLS back-compat.
    app_role?: AppRole;     // New: 'admin' | 'user' — global capability.
    status: UserStatus;
    created_at?: Date;
    updated_at?: Date;
}

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

    // Multi-apartment support
    get units(): UserUnit[] { return this.props.units || []; }
    get buildingRoles(): BuildingRole[] { return this.props.buildingRoles || []; }

    // Helper to get primary unit ID if needed for backward compat in logic
    get primaryUnitId(): string | undefined {
        return this.primaryUnit?.unit_id || this.units[0]?.unit_id;
    }

    get role(): UserRole { return this.props.role; }
    get status(): UserStatus { return this.props.status; }
    get created_at(): Date { return this.props.created_at!; }
    get updated_at(): Date { return this.props.updated_at!; }

    /**
     * Global system capability. Source of truth for "is this a staff/admin user?".
     * Falls back to deriving from the legacy `role` column until Phase 4 drops it.
     */
    get app_role(): AppRole {
        if (this.props.app_role) return this.props.app_role;
        return this.props.role === UserRole.ADMIN ? 'admin' : 'user';
    }

    get primaryUnit(): UserUnit | undefined {
        return this.units.find(u => u.is_primary);
    }

    /**
     * Phase 2 semantics:
     *  - isAdmin: global capability via app_role
     *  - isBoardMember: has a board membership in ANY building (was: legacy global role === 'board')
     *  - isResident: the complement — neither global admin nor board anywhere
     *
     * A user can be board in building A and resident in building B. Per-building
     * questions ("is board in THIS building?") go through isBoardInBuilding(id).
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

    updateProfile(data: Partial<Omit<UserProps, 'id' | 'email' | 'role' | 'status' | 'created_at' | 'updated_at' | 'units' | 'buildingRoles'>>): void {
        this.props = {
            ...this.props,
            ...data,
            updated_at: new Date()
        };
    }

    changeRole(newRole: UserRole): void {
        this.props.role = newRole;
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
     * Get all buildings where user is board
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
