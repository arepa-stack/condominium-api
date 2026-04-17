import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { GetUserUnits } from '@/modules/users/application/use-cases/GetUserUnits';
import { User } from '@/modules/users/domain/entities/User';
import { UserStatus } from '@/core/domain/enums';
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
        mockRepo.findById = mock(async () => existing);
        const spy = mock(async () => ({ items: [], total: 0 }));
        mockRepo.findUnitsByProfilePaginated = spy;

        const result = await useCase.execute('user-1', { page: 2, limit: 5 });

        expect(spy).toHaveBeenCalled();
        const call = spy.mock.calls[0] as any;
        expect(call[0]).toBe('user-1');
        expect(call[1]).toMatchObject({ page: 2, limit: 5, isAll: false });

        expect(result.data).toBeArray();
        expect(result.metadata).toMatchObject({
            total: expect.any(Number),
            page: expect.any(Number),
            limit: expect.any(Number),
            totalPages: expect.any(Number),
            hasNextPage: expect.any(Boolean),
            hasPrevPage: expect.any(Boolean),
        });
    });
});
