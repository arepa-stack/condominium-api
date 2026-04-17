import { describe, it, expect, beforeEach } from 'bun:test';
import { CreateUser } from '@/modules/users/application/use-cases/CreateUser';
import { MockUserRepository } from '../mocks';
import { MockAuthRepository } from '../../auth/mocks';
import { UserRole, UserStatus } from '@/core/domain/enums';

describe('CreateUser Use Case', () => {
    let userRepo: MockUserRepository;
    let authRepo: MockAuthRepository;
    let useCase: CreateUser;

    const BUILDING_ID = 'building-1';

    beforeEach(async () => {
        userRepo = new MockUserRepository();
        authRepo = new MockAuthRepository();
        useCase = new CreateUser(userRepo, authRepo);
    });

    it('should create a new user with detached building role for board members', async () => {
        // CreateUser's DTO still takes the ergonomic `role: UserRole` input —
        // the use case translates it: BOARD → app_role='user' + buildingRole row.
        const newUser = await useCase.execute({
            email: 'board@test.com',
            name: 'Board Member',
            role: UserRole.BOARD,
            building_id: BUILDING_ID,
            unit_id: '101'
        });

        expect(newUser.email).toBe('board@test.com');
        expect(newUser.status).toBe(UserStatus.ACTIVE);
        expect(newUser.app_role).toBe('user');

        // Check units
        expect(newUser.units.length).toBe(1);
        expect(newUser.units[0].unit_id).toBe('101');

        // Check building roles (detached)
        expect(newUser.buildingRoles.length).toBe(1);
        expect(newUser.buildingRoles[0].building_id).toBe(BUILDING_ID);
        expect(newUser.buildingRoles[0].role).toBe('board');
    });

    it('should create a regular resident without building role', async () => {
        const newUser = await useCase.execute({
            email: 'resident@test.com',
            name: 'Resident',
            role: UserRole.RESIDENT,
            building_id: BUILDING_ID,
            unit_id: '102'
        });

        expect(newUser.units.length).toBe(1);
        expect(newUser.buildingRoles.length).toBe(0);
        expect(newUser.app_role).toBe('user');
    });
});
