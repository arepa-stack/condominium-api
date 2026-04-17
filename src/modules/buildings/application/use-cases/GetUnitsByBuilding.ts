import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { Unit } from '@/modules/buildings/domain/entities/Unit';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export class GetUnitsByBuilding {
    constructor(private unitRepo: IUnitRepository) { }

    async execute(buildingId: string): Promise<Unit[]> {
        return await this.unitRepo.findByBuildingId(buildingId);
    }

    async executePaginated(
        buildingId: string,
        input?: PaginationInput
    ): Promise<PaginatedResult<Unit>> {
        const pagination = parsePaginationFilters(input);
        const { items, total } = await this.unitRepo.findByBuildingIdPaginated(buildingId, pagination);
        return buildPaginatedResult(items, total, pagination);
    }
}
