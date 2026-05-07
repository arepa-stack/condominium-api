import { describe, it, expect, beforeEach } from 'bun:test';
import { ApproveUser } from '@/modules/users/application/use-cases/ApproveUser';
import { IUserRepository } from '@/modules/users/domain/repository';
import { User } from '@/modules/users/domain/entities/User';
import { UserUnit } from '@/modules/users/domain/entities/UserUnit';
import { BuildingRole } from '@/modules/users/domain/entities/BuildingRole';
import { UserStatus } from '@/core/domain/enums';
import { ForbiddenError, NotFoundError } from '@/core/errors';

// Mock Repository
class MockUserRepository implements IUserRepository {
    users: Map<string, User> = new Map();

    async create(user: User): Promise<User> {
        this.users.set(user.id, user);
        return user;
    }
    async findById(id: string): Promise<User | null> {
        return this.users.get(id) || null;
    }
    async findByEmail(_email: string): Promise<User | null> {
        return null;
    }
    async update(user: User): Promise<User> {
        this.users.set(user.id, user);
        return user;
    }
    async findAll(): Promise<User[]> {
        return Array.from(this.users.values());
    }
    async findAllPaginated() {
        return { items: Array.from(this.users.values()), total: this.users.size };
    }
    async findUnitsByProfilePaginated(profileId: string) {
        const user = this.users.get(profileId);
        const units = user?.units ?? [];
        return { items: units, total: units.length };
    }
    async removeUnit(userId: string, unitId: string): Promise<void> {
        const user = this.users.get(userId);
        if (!user) return;
        user.setUnits(user.units.filter(u => u.unit_id !== unitId));
    }
    async delete(id: string): Promise<void> {
        this.users.delete(id);
    }
}

describe('ApproveUser Use Case', () => {
    let repo: MockUserRepository;
    let useCase: ApproveUser;

    beforeEach(() => {
        repo = new MockUserRepository();
        useCase = new ApproveUser(repo);
    });

    const createResident = (id: string, buildingId: string = 'b1') => {
        const u = new User({
            id, email: 'res@test.com', name: 'Res', app_role: 'user' as const, status: UserStatus.PENDING, created_at: new Date(), updated_at: new Date()
        });
        u.setUnits([new UserUnit({ unit_id: 'u1', building_id: buildingId, is_primary: true })]);
        return u;
    };

    const createBoard = (id: string, buildingId: string = 'b1') => {
        const u = new User({
            id, email: 'board@test.com', name: 'Board', app_role: 'user' as const, status: UserStatus.ACTIVE, created_at: new Date(), updated_at: new Date()
        });
        u.setBuildingRoles([new BuildingRole({ building_id: buildingId, role: 'board' })]);
        return u;
    };

    const createAdmin = (id: string) => new User({
        id, email: 'admin@test.com', name: 'Admin', app_role: 'admin' as const, status: UserStatus.ACTIVE, created_at: new Date(), updated_at: new Date()
    });

    it('should approve user when requested by admin', async () => {
        const admin = createAdmin('admin1');
        const resident = createResident('res1');
        await repo.create(admin);
        await repo.create(resident);

        await useCase.execute({ targetUserId: 'res1', approverId: 'admin1' });

        const updated = await repo.findById('res1');
        expect(updated?.status).toBe(UserStatus.ACTIVE);
    });

    it('should approve user when requested by board member of same building', async () => {
        const board = createBoard('board1', 'buildingA');
        const resident = createResident('res1', 'buildingA');
        await repo.create(board);
        await repo.create(resident);

        await useCase.execute({ targetUserId: 'res1', approverId: 'board1' });

        const updated = await repo.findById('res1');
        expect(updated?.status).toBe(UserStatus.ACTIVE);
    });

    it('should fail when board member is from different building', async () => {
        const board = createBoard('board1', 'buildingA');
        const resident = createResident('res1', 'buildingB');
        await repo.create(board);
        await repo.create(resident);

        expect(useCase.execute({ targetUserId: 'res1', approverId: 'board1' }))
            .rejects.toThrow(ForbiddenError);
    });

    it('should fail when approver is resident', async () => {
        const res2 = createResident('res2'); // Approver, even if active
        res2.approve();
        const resident = createResident('res1');
        await repo.create(res2);
        await repo.create(resident);

        expect(useCase.execute({ targetUserId: 'res1', approverId: 'res2' }))
            .rejects.toThrow(ForbiddenError);
    });

    it('should fail if target user does not exist', async () => {
        const admin = createAdmin('admin1');
        await repo.create(admin);

        expect(useCase.execute({ targetUserId: 'nonexistent', approverId: 'admin1' }))
            .rejects.toThrow(NotFoundError);
    });

    it('should approve user when board member has no units but has building role', async () => {
        const board = new User({
            id: 'board_no_units', email: 'board2@test.com', name: 'Board No Units', app_role: 'user' as const, status: UserStatus.ACTIVE, created_at: new Date(), updated_at: new Date()
        });
        board.setBuildingRoles([new BuildingRole({ building_id: 'buildingA', role: 'board' })]);

        const resident = createResident('res1', 'buildingA');
        await repo.create(board);
        await repo.create(resident);

        await useCase.execute({ targetUserId: 'res1', approverId: 'board_no_units' });

        const updated = await repo.findById('res1');
        expect(updated?.status).toBe(UserStatus.ACTIVE);
    });

    it('should fail when board member has a unit but no building role', async () => {
        const board = new User({
            id: 'board_with_unit_only', email: 'board3@test.com', name: 'Board Unit Only', app_role: 'user' as const, status: UserStatus.ACTIVE, created_at: new Date(), updated_at: new Date()
        });
        // Has unit in buildingA, but NO buildingRole
        board.setUnits([new UserUnit({ unit_id: 'u3', building_id: 'buildingA', is_primary: true })]);

        const resident = createResident('res1', 'buildingA');
        await repo.create(board);
        await repo.create(resident);

        expect(useCase.execute({ targetUserId: 'res1', approverId: 'board_with_unit_only' }))
            .rejects.toThrow(ForbiddenError);
    });
});
