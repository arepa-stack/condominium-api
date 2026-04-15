import { BoardMember } from './entities/BoardMember';
import { ResidentialWorker } from './entities/ResidentialWorker';

export interface BoardMemberListFilters {
    onlyActive?: boolean;
    onlyCurrentBoard?: boolean;
}

export interface IBoardMemberRepository {
    create(member: BoardMember): Promise<BoardMember>;
    update(member: BoardMember): Promise<BoardMember>;
    findById(id: string): Promise<BoardMember | null>;
    findByBuildingId(buildingId: string, filters?: BoardMemberListFilters): Promise<BoardMember[]>;
}

export interface ResidentialWorkerListFilters {
    onlyActive?: boolean;
}

export interface IResidentialWorkerRepository {
    create(worker: ResidentialWorker): Promise<ResidentialWorker>;
    update(worker: ResidentialWorker): Promise<ResidentialWorker>;
    findById(id: string): Promise<ResidentialWorker | null>;
    findByBuildingId(buildingId: string, filters?: ResidentialWorkerListFilters): Promise<ResidentialWorker[]>;
}
