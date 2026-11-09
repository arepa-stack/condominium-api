import { IBuildingRepository } from '../../domain/repository';
import { Building } from '../../domain/entities/Building';
import { IUserRepository } from '@/modules/users/domain/repository';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/errors';
import type { RateSource } from '@/core/domain/ports/IExchangeRateService';

export interface UpdateBuildingDTO {
    id: string;
    name?: string;
    address?: string;
    default_rate_source?: RateSource;
    building_code?: string;
    updaterId: string;
}

export class UpdateBuilding {
    constructor(
        private buildingRepo: IBuildingRepository,
        private userRepo: IUserRepository
    ) { }

    async execute(dto: UpdateBuildingDTO): Promise<Building> {
        const updater = await this.userRepo.findById(dto.updaterId);
        if (!updater) {
            throw new NotFoundError('User not found');
        }

        if (!updater.isAdmin()) {
            throw new ForbiddenError('Only admins can update buildings');
        }

        const building = await this.buildingRepo.findById(dto.id);
        if (!building) {
            throw new NotFoundError('Building not found');
        }

        if (dto.name) building.updateName(dto.name);
        if (dto.address) building.updateAddress(dto.address);
        if (dto.default_rate_source) building.setDefaultRateSource(dto.default_rate_source);
        if (dto.building_code) {
            const code = dto.building_code.trim().toUpperCase();
            const owner = await this.buildingRepo.findByCode(code);
            if (owner && owner.id !== building.id) {
                throw new DomainError('Building code already in use', 'CONFLICT', 409);
            }
            building.updateBuildingCode(code);
        }

        return await this.buildingRepo.update(building);
    }
}
