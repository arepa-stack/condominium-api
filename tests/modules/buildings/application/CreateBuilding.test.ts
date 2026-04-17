import { describe, it, expect, beforeEach } from 'bun:test';
import { CreateBuilding } from '@/modules/buildings/application/use-cases/CreateBuilding';
import { MockBuildingRepository } from '../mocks';
import { MockUserRepository } from '../../users/mocks';
import { User } from '@/modules/users/domain/entities/User';
import { UserRole, UserStatus } from '@/core/domain/enums';

describe('CreateBuilding Use Case', () => {
    let buildingRepo: MockBuildingRepository;
    let userRepo: MockUserRepository;
    let createBuilding: CreateBuilding;

    beforeEach(() => {
        buildingRepo = new MockBuildingRepository();
        userRepo = new MockUserRepository();
        createBuilding = new CreateBuilding(buildingRepo, userRepo);
    });

    it('should create a building when requested by admin', async () => {
        const admin = new User({
            id: 'admin-1',
            email: 'admin@test.com',
            name: 'Admin',

            app_role: 'admin' as const,
            status: UserStatus.ACTIVE
        });
        await userRepo.create(admin);

        const building = await createBuilding.execute({
            name: 'New Building',
            address: '123 Test St',
            creatorId: 'admin-1'
        });

        expect(building.name).toBe('New Building');
        expect(building.address).toBe('123 Test St');
    });

    it('should fail when requested by non-admin', async () => {
        const resident = new User({
            id: 'resident-1',
            email: 'resident@test.com',
            name: 'Resident',

            app_role: 'user' as const,
            status: UserStatus.ACTIVE
        });
        await userRepo.create(resident);

        expect(async () => {
            await createBuilding.execute({
                name: 'New Building',
                address: '123 Test St',
                creatorId: 'resident-1'
            });
        }).toThrow();
    });
});
