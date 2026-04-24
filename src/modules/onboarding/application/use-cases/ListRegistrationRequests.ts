import { RegistrationRequest, RegistrationRequestStatus } from '../../domain/entities/RegistrationRequest';
import { IRegistrationRequestRepository } from '../../domain/repository';
import { ForbiddenError } from '@/core/errors';

export interface ListRegistrationRequestsDTO {
    requesterAppRole: string;
    requesterBoardBuildingIds: string[];
    buildingId?: string;
    status?: RegistrationRequestStatus;
}

export class ListRegistrationRequests {
    constructor(private requestRepo: IRegistrationRequestRepository) {}

    async execute(dto: ListRegistrationRequestsDTO): Promise<RegistrationRequest[]> {
        const isAdmin = dto.requesterAppRole === 'admin';

        if (!isAdmin && dto.requesterBoardBuildingIds.length === 0) {
            throw new ForbiddenError('Access denied');
        }

        if (!isAdmin && dto.buildingId && !dto.requesterBoardBuildingIds.includes(dto.buildingId)) {
            throw new ForbiddenError('You are not a board member of this building');
        }

        const effectiveBuildingId = isAdmin
            ? dto.buildingId
            : dto.buildingId ?? dto.requesterBoardBuildingIds[0];

        return await this.requestRepo.findAll({
            building_id: effectiveBuildingId,
            status: dto.status,
        });
    }
}
