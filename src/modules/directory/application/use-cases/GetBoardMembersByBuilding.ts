import { IBoardMemberRepository } from '../../domain/repository';

export interface GetBoardMembersByBuildingDTO {
    buildingId: string;
    /** Para residentes / app: solo vigentes y activos */
    publicView?: boolean;
}

export class GetBoardMembersByBuilding {
    constructor(private readonly repo: IBoardMemberRepository) {}

    async execute(dto: GetBoardMembersByBuildingDTO) {
        if (dto.publicView) {
            return this.repo.findByBuildingId(dto.buildingId, {
                onlyActive: true,
                onlyCurrentBoard: true,
            });
        }
        return this.repo.findByBuildingId(dto.buildingId);
    }
}
