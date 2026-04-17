import { describe, it, expect, beforeEach } from 'bun:test';
import { LoginUser } from '@/modules/auth/domain/use-cases/login-user';
import { MockAuthRepository } from '../mocks';
import { MockUserRepository } from '../../users/mocks';
import { User } from '@/modules/users/domain/entities/User';
import { UserRole, UserStatus } from '@/core/domain/enums';

describe('LoginUser Use Case', () => {
    let authRepo: MockAuthRepository;
    let userRepo: MockUserRepository;
    let loginUser: LoginUser;

    beforeEach(() => {
        authRepo = new MockAuthRepository();
        userRepo = new MockUserRepository();
        loginUser = new LoginUser(authRepo, userRepo);
    });

    it('should login successfully', async () => {
        // Create user profile first
        const user = new User({
            id: 'auth-id-1',
            email: 'test@test.com',
            name: 'Test',

            app_role: 'user' as const,
            status: UserStatus.ACTIVE
        });
        await userRepo.create(user);

        const result = await loginUser.execute('test@test.com', 'password');

        expect(result.token.access_token).toBe('mock-access-token');
        expect(result.user.id).toBe('auth-id-1');
    });

    it('should fail if user profile does not exist', async () => {
        expect(async () => {
            await loginUser.execute('unknown@test.com', 'password');
        }).toThrow();
    });

    it('should fail if user status is PENDING', async () => {
        const user = new User({
            id: 'auth-id-1',
            email: 'pending@test.com',
            name: 'Pending User',

            app_role: 'user' as const,
            status: UserStatus.PENDING
        });
        await userRepo.create(user);

        // Mock auth repo needs to support this email or return success regardless of email in mock
        // Our current mock returns success for any email
        expect(async () => {
            await loginUser.execute('pending@test.com', 'password');
        }).toThrow('User account is pending');
    });
});
