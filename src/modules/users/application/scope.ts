import { User } from '../domain/entities/User';
import { UserUnit } from '../domain/entities/UserUnit';
import { BuildingRole } from '../domain/entities/BuildingRole';

/**
 * Caller's building reach for admin endpoints.
 * `null` = unrestricted (admin); `Set` = whitelist of buildings the caller governs.
 */
export type BuildingScope = null | Set<string>;

export function getBuildingScope(requester: User): BuildingScope {
    if (requester.isAdmin()) return null;
    return new Set(requester.getBuildingsWhereBoard());
}

export function isBuildingInScope(scope: BuildingScope, buildingId: string | undefined): boolean {
    if (scope === null) return true;
    if (!buildingId) return false;
    return scope.has(buildingId);
}

/**
 * Mutates the user's embedded units/buildingRoles arrays to only include
 * entries whose building is within the caller's scope. Self-fetches should
 * skip this (caller wants their own complete profile).
 */
export function filterUserToScope(user: User, scope: BuildingScope): void {
    if (scope === null) return;
    const filteredUnits = user.units.filter(u => isBuildingInScope(scope, u.building_id));
    const filteredRoles = user.buildingRoles.filter(r => isBuildingInScope(scope, r.building_id));
    user.setUnits(filteredUnits as UserUnit[]);
    user.setBuildingRoles(filteredRoles as BuildingRole[]);
}
