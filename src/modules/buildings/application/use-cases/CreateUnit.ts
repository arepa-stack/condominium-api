import { IUnitRepository, IBuildingRepository } from '@/modules/buildings/domain/repository';
import { Unit } from '@/modules/buildings/domain/entities/Unit';
import { DomainError, NotFoundError } from '@/core/errors';

interface CreateUnitDTO {
    building_id: string;
    name: string;
    floor?: string;
    aliquot?: number;
}

export class CreateUnit {
    constructor(
        private unitRepo: IUnitRepository,
        private buildingRepo: IBuildingRepository
    ) { }

    async execute(data: CreateUnitDTO): Promise<Unit> {
        // Validate building exists
        const building = await this.buildingRepo.findById(data.building_id);
        if (!building) {
            throw new NotFoundError('Building not found');
        }

        const floorPrefix = data.floor ? `${data.floor}-` : '';
        const name = data.name.startsWith(floorPrefix) ? data.name : `${floorPrefix}${data.name}`;

        const unit = new Unit({
            id: crypto.randomUUID(),
            building_id: data.building_id,
            name: name,
            floor: data.floor,
            aliquot: data.aliquot
        });

        return await this.unitRepo.create(unit);
    }
}
