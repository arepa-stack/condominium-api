import { IUnitRepository, IBuildingRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';

interface DeleteUnitsByBuildingDTO {
    buildingId: string;
    deleterId: string;
    excludeIds?: string[];
}

export class DeleteUnitsByBuilding {
    constructor(
        private unitRepo: IUnitRepository,
        private buildingRepo: IBuildingRepository,
        private userRepo: IUserRepository
    ) { }

    async execute({ buildingId, deleterId, excludeIds = [] }: DeleteUnitsByBuildingDTO): Promise<{ deletedCount: number }> {
        const deleter = await this.userRepo.findById(deleterId);
        if (!deleter) {
            throw new NotFoundError('User not found');
        }
        if (!deleter.isAdmin()) {
            throw new ForbiddenError('Only admins can delete units');
        }

        const building = await this.buildingRepo.findById(buildingId);
        if (!building) {
            throw new NotFoundError('Building not found');
        }

        const units = await this.unitRepo.findByBuildingId(buildingId);
        const excludeSet = new Set(excludeIds);
        const toDelete = units.filter(unit => !excludeSet.has(unit.id));

        await Promise.all(toDelete.map(unit => this.unitRepo.delete(unit.id)));

        return { deletedCount: toDelete.length };
    }
}
