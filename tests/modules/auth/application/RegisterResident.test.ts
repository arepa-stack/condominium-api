import { describe, it, expect, beforeEach } from 'bun:test';
import { RegisterResident } from '@/modules/auth/domain/use-cases/register-resident';
import { MockAuthRepository } from '../mocks';
import { MockUserRepository } from '../../users/mocks';

describe('RegisterResident Use Case', () => {
    let authRepo: MockAuthRepository;
    let userRepo: MockUserRepository;
    let registerResident: RegisterResident;

    beforeEach(() => {
        authRepo = new MockAuthRepository();
        userRepo = new MockUserRepository();
        registerResident = new RegisterResident(authRepo, userRepo);
    });

    it('should register a new resident', async () => {
        const result = await registerResident.execute({
            name: 'New Resident',
            email: 'resident@test.com',
            password: 'password123',
            unit_id: '101',
            building_id: 'building-1'
        });

        expect(result.access_token).toBe('mock-access-token');
        expect(result.user.email).toBe('resident@test.com');

        // Check if user profile was created
        const users = await userRepo.findAll();
        expect(users).toHaveLength(1);
        expect(users[0].name).toBe('New Resident');
    });

});
