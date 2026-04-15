import type { BoardMember } from '../../domain/entities/BoardMember';
import { IBoardMemberRepository } from '../../domain/repository';

export interface GetBoardMembersByBuildingDTO {
    buildingId: string;
    /** Para residentes / app: solo vigentes y activos */
    publicView?: boolean;
}

function sortBoardMembers(a: BoardMember, b: BoardMember): number {
    const r = a.role.localeCompare(b.role, 'es');
    if (r !== 0) return r;
    return a.last_name.localeCompare(b.last_name, 'es');
}

export class GetBoardMembersByBuilding {
    constructor(private readonly repo: IBoardMemberRepository) {}

    async execute(dto: GetBoardMembersByBuildingDTO): Promise<BoardMember[]> {
        const filters = dto.publicView
            ? { onlyActive: true, onlyCurrentBoard: true }
            : {};

        const list = await this.repo.findByBuildingId(dto.buildingId, filters);
        list.sort(sortBoardMembers);
        return list;
    }
}
