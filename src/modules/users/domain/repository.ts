import { User } from './entities/User';
import { UserUnit } from './entities/UserUnit';
import { UserRole, UserStatus } from '@/core/domain/enums';
import { PaginationFilters } from '@/core/domain/pagination';

export interface FindAllUsersFilters {
    building_id?: string;
    unit_id?: string;
    role?: UserRole;
    status?: UserStatus;
    page?: number | string;
    limit?: number | string;
}

export interface IUserRepository {
    create(user: User): Promise<User>;
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    update(user: User): Promise<User>;
    findAll(filters?: FindAllUsersFilters): Promise<User[]>;
    findAllPaginated(
        filters: FindAllUsersFilters,
        pagination: PaginationFilters
    ): Promise<{ items: User[]; total: number }>;
    findUnitsByProfilePaginated(
        profileId: string,
        pagination: PaginationFilters,
        buildingIds?: string[]
    ): Promise<{ items: UserUnit[]; total: number }>;
    removeUnit(userId: string, unitId: string): Promise<void>;
    delete(id: string): Promise<void>;
}
