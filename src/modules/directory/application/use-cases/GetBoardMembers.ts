import { IDirectoryRepository } from '../../domain/repository';
import { BoardMember } from '../../domain/entities/BoardMember';

export class GetBoardMembers {
    constructor(private directoryRepo: IDirectoryRepository) {}

    async execute(buildingId: string): Promise<BoardMember[]> {
        return await this.directoryRepo.findBoardMembersByBuildingId(buildingId);
    }
}
