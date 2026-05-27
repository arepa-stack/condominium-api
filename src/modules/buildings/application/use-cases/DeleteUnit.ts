import { IUnitRepository } from '../../domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';

interface DeleteUnitDTO {
    buildingId: string;
    unitId: string;
    deleterId: string;
}

export class DeleteUnit {
    constructor(
        private unitRepo: IUnitRepository,
        private userRepo: IUserRepository
    ) { }

    async execute({ buildingId, unitId, deleterId }: DeleteUnitDTO): Promise<void> {
        const deleter = await this.userRepo.findById(deleterId);
        if (!deleter) {
            throw new NotFoundError('User not found');
        }
        if (!deleter.isAdmin()) {
            throw new ForbiddenError('Only admins can delete units');
        }

        const unit = await this.unitRepo.findById(unitId);
        if (!unit || unit.building_id !== buildingId) {
            throw new NotFoundError('Unit not found');
        }

        await this.unitRepo.delete(unitId);
    }
}
