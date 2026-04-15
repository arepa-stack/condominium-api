import { IResidentialWorkerRepository } from '../../domain/repository';

export interface GetResidentialWorkersByBuildingDTO {
    buildingId: string;
    publicView?: boolean;
}

export class GetResidentialWorkersByBuilding {
    constructor(private readonly repo: IResidentialWorkerRepository) {}

    async execute(dto: GetResidentialWorkersByBuildingDTO) {
        if (dto.publicView) {
            return this.repo.findByBuildingId(dto.buildingId, { onlyActive: true });
        }
        return this.repo.findByBuildingId(dto.buildingId);
    }
}
