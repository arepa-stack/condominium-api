import { IBuildingRepository, IUnitRepository } from '../../domain/repository';
import { Building } from '../../domain/entities/Building';
import { Unit } from '../../domain/entities/Unit';
import { NotFoundError } from '@/core/errors';

export interface BuildingByCodeResult {
    building: Building;
    units: Unit[];
}

export class GetBuildingByCode {
    constructor(
        private buildingRepo: IBuildingRepository,
        private unitRepo: IUnitRepository
    ) {}

    async execute(buildingCode: string): Promise<BuildingByCodeResult> {
        const building = await this.buildingRepo.findByCode(buildingCode);
        if (!building) {
            throw new NotFoundError('Building not found');
        }

        const units = await this.unitRepo.findByBuildingId(building.id);

        return { building, units };
    }
}
