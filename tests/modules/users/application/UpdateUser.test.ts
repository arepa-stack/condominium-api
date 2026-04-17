import { describe, it, expect, beforeEach } from 'bun:test';
import { UpdateUser } from '@/modules/users/application/use-cases/UpdateUser';
import { MockUserRepository } from '../mocks';
import { User } from '@/modules/users/domain/entities/User';
import { UserStatus } from '@/core/domain/enums';
import { ForbiddenError } from '@/core/errors';

describe('UpdateUser Use Case', () => {
    let repo: MockUserRepository;
    let useCase: UpdateUser;

    const createResident = (id: string, name: string = 'Res') => new User({
        id, email: 'res@test.com', name, app_role: 'user' as const, status: UserStatus.ACTIVE, created_at: new Date(), updated_at: new Date()
    });

    const createAdmin = (id: string) => new User({
        id, email: 'admin@test.com', name: 'Admin', app_role: 'admin' as const, status: UserStatus.ACTIVE, created_at: new Date(), updated_at: new Date()
    });

    beforeEach(() => {
        repo = new MockUserRepository();
        useCase = new UpdateUser(repo);
    });

    it('should allow user to update their own profile', async () => {
        const user = createResident('u1', 'Old Name');
        await repo.create(user);

        const updated = await useCase.execute({
            id: 'u1',
            updaterId: 'u1',
            data: { name: 'New Name' }
        });

        expect(updated.name).toBe('New Name');
        expect(repo.users.find(u => u.id === 'u1')!.name).toBe('New Name');
    });

    it('should allow admin to update any profile', async () => {
        const admin = createAdmin('adm1');
        const user = createResident('u1', 'Old Name');
        await repo.create(admin);
        await repo.create(user);

        const updated = await useCase.execute({
            id: 'u1',
            updaterId: 'adm1',
            data: { name: 'Admin Updated' }
        });

        expect(updated.name).toBe('Admin Updated');
    });

    it('should prevent user from updating their role', async () => {
        const user = createResident('u1');
        await repo.create(user);

        expect(useCase.execute({
            id: 'u1',
            updaterId: 'u1',
            data: { app_role: 'admin' as const } as any
        })).rejects.toThrow(ForbiddenError);
    });

    it('should allow admin to promote another user to admin via app_role', async () => {
        const admin = createAdmin('adm1');
        const user = createResident('u1');
        await repo.create(admin);
        await repo.create(user);

        const updated = await useCase.execute({
            id: 'u1',
            updaterId: 'adm1',
            data: { app_role: 'admin' as const }
        });

        expect(updated.app_role).toBe('admin');
        expect(updated.isAdmin()).toBe(true);
    });
});
