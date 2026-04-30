import { ForbiddenError, ValidationError } from '@/core/errors';

export interface InformationCenterCaller {
    userId: string;
    appRole: string;
    boardBuildingIds: string[];
    residentBuildingIds: string[];
}

export function ensureCanManageBuilding(caller: InformationCenterCaller, buildingId: string): void {
    if (!buildingId) throw new ValidationError('building_id is required');
    if (caller.appRole === 'admin') return;
    if (caller.boardBuildingIds.includes(buildingId)) return;

    throw new ForbiddenError(`Access denied. You cannot manage building ${buildingId}`);
}

export function ensureCanReadBuilding(caller: InformationCenterCaller, buildingId: string): void {
    if (!buildingId) throw new ValidationError('building_id is required');
    if (caller.appRole === 'admin') return;
    if (caller.boardBuildingIds.includes(buildingId)) return;
    if (caller.residentBuildingIds.includes(buildingId)) return;

    throw new ForbiddenError(`Access denied. You cannot read building ${buildingId}`);
}

export function resolveReadableBuildingId(
    caller: InformationCenterCaller,
    requestedBuildingId?: string
): string {
    if (requestedBuildingId) {
        ensureCanReadBuilding(caller, requestedBuildingId);
        return requestedBuildingId;
    }

    const [defaultBuildingId] = [
        ...caller.boardBuildingIds,
        ...caller.residentBuildingIds,
    ];

    if (defaultBuildingId) return defaultBuildingId;
    throw new ValidationError('building_id is required');
}
