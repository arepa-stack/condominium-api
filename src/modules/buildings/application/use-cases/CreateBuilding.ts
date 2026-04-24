import { randomBytes } from 'crypto';
import { IBuildingRepository } from '../../domain/repository';
import { Building, BuildingProps } from '../../domain/entities/Building';
import { IUserRepository } from '@/modules/users/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { Config } from '@/core/config';

export interface CreateBuildingDTO {
    name: string;
    address: string;
    creatorId: string;
    max_residents_per_unit?: number;
}

export class CreateBuilding {
    constructor(
        private buildingRepo: IBuildingRepository,
        private userRepo: IUserRepository
    ) { }

    async execute(dto: CreateBuildingDTO): Promise<Building> {
        const creator = await this.userRepo.findById(dto.creatorId);
        if (!creator) {
            throw new NotFoundError('User not found');
        }

        if (!creator.isAdmin()) {
            throw new ForbiddenError('Only admins can create buildings');
        }

        const id = crypto.randomUUID();
        const buildingCode = await this.generateUniqueCode();

        const buildingProps: BuildingProps = {
            id,
            name: dto.name,
            address: dto.address,
            building_code: buildingCode,
            max_residents_per_unit: dto.max_residents_per_unit ?? Config.DEFAULT_MAX_RESIDENTS_PER_UNIT,
        };

        const building = new Building(buildingProps);
        return await this.buildingRepo.create(building);
    }

    private async generateUniqueCode(): Promise<string> {
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = 'COND-' + randomBytes(4).toString('hex').toUpperCase();
            const existing = await this.buildingRepo.findByCode(code);
            if (!existing) return code;
        }
        throw new Error('Could not generate unique building code after 5 attempts');
    }
}
