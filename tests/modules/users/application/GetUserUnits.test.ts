import { describe, it, expect, test, mock, beforeEach } from 'bun:test';
import { GetUserUnits } from '@/modules/users/application/use-cases/GetUserUnits';
import { User } from '@/modules/users/domain/entities/User';
import { UserStatus } from '@/core/domain/enums';
import { BuildingRole } from '@/modules/users/domain/entities/BuildingRole';
import { createMockUserRepository } from '../../../mocks/repositories';

describe('GetUserUnits — pagination', () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: GetUserUnits;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new GetUserUnits(mockRepo);
    });

    it('forwards page + limit to the paginated repo call and returns a PaginatedResult', async () => {
        const existing = new User({
            id: 'user-1',
            email: 'u@test.com',
            name: 'User',
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            units: [],
            buildingRoles: [],
        });
        const admin = new User({
            id: 'admin-1',
            email: 'a@test.com',
            name: 'Admin',
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => id === 'admin-1' ? admin : existing);
        const spy = mock(async () => ({ items: [], total: 0 }));
        mockRepo.findUnitsByProfilePaginated = spy;

        const result = await useCase.execute('user-1', 'admin-1', { page: 2, limit: 5 });

        expect(spy).toHaveBeenCalled();
        const call = spy.mock.calls[0] as any;
        expect(call[0]).toBe('user-1');
        expect(call[1]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            total_pages: expect.any(Number),
            has_next_page: expect.any(Boolean),
            has_prev_page: expect.any(Boolean),
        });
    });
});

describe('GetUserUnits — building scope', () => {
    let mockRepo: ReturnType<typeof createMockUserRepository>;
    let useCase: GetUserUnits;

    beforeEach(() => {
        mockRepo = createMockUserRepository();
        useCase = new GetUserUnits(mockRepo);
    });

    test('admin requester: no building filter passed to repo', async () => {
        const admin = new User({
            id: 'admin-1',
            email: 'a@test.com',
            name: 'Admin',
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE,
        });
        const target = new User({
            id: 'user-1',
            email: 'u@test.com',
            name: 'User',
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => id === 'admin-1' ? admin : target);
        const spy = mock(async () => ({ items: [], total: 0 }));
        mockRepo.findUnitsByProfilePaginated = spy;

        await useCase.execute('user-1', 'admin-1');

        const call = spy.mock.calls[0] as any;
        // 3rd arg = optional buildingIds whitelist; admin → undefined
        expect(call[2]).toBeUndefined();
    });

    test('board requester: building scope passed as whitelist to repo', async () => {
        const board = new User({
            id: 'board-1',
            email: 'b@test.com',
            name: 'Board',
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [
                new BuildingRole({ building_id: 'building-A', role: 'board' }),
                new BuildingRole({ building_id: 'building-B', role: 'board' }),
            ],
        });
        const target = new User({
            id: 'user-1',
            email: 'u@test.com',
            name: 'User',
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => id === 'board-1' ? board : target);
        const spy = mock(async () => ({ items: [], total: 0 }));
        mockRepo.findUnitsByProfilePaginated = spy;

        await useCase.execute('user-1', 'board-1');

        const call = spy.mock.calls[0] as any;
        expect(call[2]).toBeDefined();
        expect((call[2] as string[]).sort()).toEqual(['building-A', 'building-B']);
    });

    test('non-admin non-board requester is forbidden', async () => {
        const resident = new User({
            id: 'resident-1',
            email: 'r@test.com',
            name: 'Resident',
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
            buildingRoles: [],
        });
        const target = new User({
            id: 'user-1',
            email: 'u@test.com',
            name: 'User',
            app_role: 'user' as const,
            status: UserStatus.ACTIVE,
        });
        mockRepo.findById = mock(async (id: string) => id === 'resident-1' ? resident : target);

        await expect(useCase.execute('user-1', 'resident-1'))
            .rejects.toThrow('Only admins and board members can view user units');
    });
});
