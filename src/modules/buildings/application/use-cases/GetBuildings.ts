import { IBuildingRepository } from '../../domain/repository';
import { Building } from '../../domain/entities/Building';
import {
    PaginatedResult,
    PaginationInput,
    buildPaginatedResult,
    parsePaginationFilters,
} from '@/core/domain/pagination';

export class GetBuildings {
    constructor(private buildingRepo: IBuildingRepository) { }

    async execute(): Promise<Building[]> {
        return await this.buildingRepo.findAll();
    }

    async executePaginated(input?: PaginationInput): Promise<PaginatedResult<Building>> {
        const pagination = parsePaginationFilters(input);
        const { items, total } = await this.buildingRepo.findAllPaginated(pagination);
        return buildPaginatedResult(items, total, pagination);
    }
}
