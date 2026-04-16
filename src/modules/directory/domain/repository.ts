import { BoardMember } from './entities/BoardMember';

export interface IDirectoryRepository {
    findBoardMembersByBuildingId(buildingId: string): Promise<BoardMember[]>;
}
