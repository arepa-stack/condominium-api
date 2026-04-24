import { IAuthRepository, AuthSession } from '@/modules/auth/domain/repository';

export class MockAuthRepository implements IAuthRepository {
    async signUp(email: string, password: string): Promise<{ id: string; email?: string }> {
        return {
            id: 'auth-id-1',
            email
        };
    }

    async signIn(email: string, password: string): Promise<AuthSession> {
        return {
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            expires_in: 3600,
            user: {
                id: 'auth-id-1',
                email
            }
        };
    }

    async createUser(email: string, password: string): Promise<{ id: string; email?: string }> {
        return {
            id: 'new-auth-id',
            email
        };
    }

    async changePassword(_userId: string, _newPassword: string): Promise<void> {}

    async resetPasswordForEmail(_email: string): Promise<void> {}
}
