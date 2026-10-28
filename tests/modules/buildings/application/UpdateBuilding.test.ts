import { describe, it, expect, beforeEach } from 'bun:test';
import { UpdateBuilding } from '@/modules/buildings/application/use-cases/UpdateBuilding';
import { MockBuildingRepository } from '../mocks';
import { MockUserRepository } from '../../users/mocks';
import { Building } from '@/modules/buildings/domain/entities/Building';
import { User } from '@/modules/users/domain/entities/User';
import { UserRole, UserStatus } from '@/core/domain/enums';

describe('UpdateBuilding Use Case', () => {
    let buildingRepo: MockBuildingRepository;
    let userRepo: MockUserRepository;
    let updateBuilding: UpdateBuilding;

    beforeEach(() => {
        buildingRepo = new MockBuildingRepository();
        userRepo = new MockUserRepository();
        updateBuilding = new UpdateBuilding(buildingRepo, userRepo);
    });

    it('should update building details when requested by admin', async () => {
        const admin = new User({
            id: 'admin-1',
            email: 'admin@test.com',
            name: 'Admin',

            app_role: 'admin' as const,
            status: UserStatus.ACTIVE
        });
        await userRepo.create(admin);

        const building = new Building({
            id: 'building-1',
            name: 'Old Name',
            address: 'Old Address'
        });
        await buildingRepo.create(building);

        const updated = await updateBuilding.execute({
            id: 'building-1',
            name: 'New Name',
            address: 'New Address',
            updaterId: 'admin-1'
        });

        expect(updated.name).toBe('New Name');
        expect(updated.address).toBe('New Address');
    });

    it('should normalize the building code and reject one already in use', async () => {
        await userRepo.create(new User({
            id: 'admin-1',
            email: 'admin@test.com',
            name: 'Admin',
            app_role: 'admin' as const,
            status: UserStatus.ACTIVE
        }));
        await buildingRepo.create(new Building({ id: 'building-1', name: 'A', address: 'A', building_code: 'COND-63178E55' }));
        await buildingRepo.create(new Building({ id: 'building-2', name: 'B', address: 'B', building_code: 'COND-TAKEN' }));

        const updated = await updateBuilding.execute({ id: 'building-1', building_code: ' res-norte ', updaterId: 'admin-1' });
        expect(updated.building_code).toBe('RES-NORTE');

        await expect(updateBuilding.execute({ id: 'building-1', building_code: 'cond-taken', updaterId: 'admin-1' })).rejects.toThrow('already in use');
        await expect(updateBuilding.execute({ id: 'building-1', building_code: 'bad code!', updaterId: 'admin-1' })).rejects.toThrow();
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

        const building = new Building({
            id: 'building-1',
            name: 'Name',
            address: 'Address'
        });
        await buildingRepo.create(building);

        expect(async () => {
            await updateBuilding.execute({
                id: 'building-1',
                name: 'New Name',
                updaterId: 'resident-1'
            });
        }).toThrow();
    });
});
