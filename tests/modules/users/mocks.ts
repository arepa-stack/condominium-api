import { IUserRepository, FindAllUsersFilters } from '@/modules/users/domain/repository';
import { User } from '@/modules/users/domain/entities/User';
import { UserUnit } from '@/modules/users/domain/entities/UserUnit';
import { PaginationFilters, toRange } from '@/core/domain/pagination';

export class MockUserRepository implements IUserRepository {
    public users: User[] = [];

    async create(user: User): Promise<User> {
        this.users.push(user);
        return user;
    }

    async findById(id: string): Promise<User | null> {
        return this.users.find(u => u.id === id) || null;
    }

    async findByEmail(email: string): Promise<User | null> {
        return this.users.find(u => u.email === email) || null;
    }

    async update(user: User): Promise<User> {
        const index = this.users.findIndex(u => u.id === user.id);
        if (index !== -1) {
            this.users[index] = user;
        }
        return user;
    }

    async findAll(filters?: FindAllUsersFilters): Promise<User[]> {
        let filtered = [...this.users];
        if (filters?.building_id) {
            filtered = filtered.filter(u => u.units.some(unit => unit.building_id === filters.building_id));
        }
        return filtered;
    }

    async findAllPaginated(
        filters: FindAllUsersFilters,
        pagination: PaginationFilters
    ): Promise<{ items: User[]; total: number }> {
        const all = await this.findAll(filters);
        const { from, to } = toRange(pagination);
        return { items: all.slice(from, to + 1), total: all.length };
    }

    async findUnitsByProfilePaginated(
        profileId: string,
        pagination: PaginationFilters
    ): Promise<{ items: UserUnit[]; total: number }> {
        const user = await this.findById(profileId);
        const units = user?.units ?? [];
        const { from, to } = toRange(pagination);
        return { items: units.slice(from, to + 1), total: units.length };
    }

    async delete(id: string): Promise<void> {
        this.users = this.users.filter(u => u.id !== id);
    }
}
