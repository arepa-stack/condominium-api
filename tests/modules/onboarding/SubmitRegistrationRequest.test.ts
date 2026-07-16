import { describe, it, expect } from 'bun:test';
import { SubmitRegistrationRequest } from '@/modules/onboarding/application/use-cases/SubmitRegistrationRequest';
import { User } from '@/modules/users/domain/entities/User';
import { UserUnit } from '@/modules/users/domain/entities/UserUnit';
import { UserStatus } from '@/core/domain/enums';

const building = { id: 'bA', name: 'Edificio A', max_residents_per_unit: 4 };
const unit = { id: 'uB', building_id: 'bA', name: '2-3' };

const baseDeps = (overrides: any = {}) => {
    const created: User[] = [];
    const updated: User[] = [];
    let authCreateCalls = 0;

    const buildingRepo = { findByCode: async () => building } as any;
    const unitRepo = { findById: async () => unit } as any;
    const authRepo = {
        createUser: async (email: string) => {
            authCreateCalls++;
            return { id: 'new-auth-id', email };
        },
    } as any;
    const emailService = { send: async () => {} } as any;

    const userRepo = {
        findByEmail: async () => null,
        hasProfileForEmailInBuilding: async () => false,
        countResidentsForUnit: async () => 0,
        findBoardMembersForBuilding: async () => [],
        create: async (u: User) => { created.push(u); return u; },
        update: async (u: User) => { updated.push(u); return u; },
        ...overrides.userRepo,
    } as any;

    const useCase = new SubmitRegistrationRequest(buildingRepo, unitRepo, authRepo, userRepo, emailService);
    return { useCase, created, updated, get authCreateCalls() { return authCreateCalls; } };
};

const dto = {
    buildingCode: 'COND-A',
    unitId: 'uB',
    email: 'argelis@test.com',
    firstName: 'Argelis',
    lastName: 'Moreno',
    documentId: '22749633',
};

describe('SubmitRegistrationRequest', () => {
    it('creates a new auth user + profile for a brand-new person, membership pending', async () => {
        const d = baseDeps();
        await d.useCase.execute(dto);

        expect(d.authCreateCalls).toBe(1);
        expect(d.created).toHaveLength(1);
        const u = d.created[0];
        expect(u.status).toBe(UserStatus.PENDING);
        expect(u.units[0].status).toBe('pending');
    });

    it('reuses an existing profile and appends a pending membership WITHOUT a new auth user', async () => {
        const existing = new User({
            id: 'existing-id', email: 'argelis@test.com', name: 'Argelis Moreno',
            app_role: 'user', status: UserStatus.ACTIVE,
        });
        existing.setUnits([new UserUnit({ unit_id: 'uA', building_id: 'bOther', is_primary: true, status: 'active' })]);

        const d = baseDeps({ userRepo: { findByEmail: async () => existing } });
        await d.useCase.execute(dto);

        // No second auth user for an email that already exists in auth.
        expect(d.authCreateCalls).toBe(0);
        expect(d.created).toHaveLength(0);
        expect(d.updated).toHaveLength(1);

        const u = d.updated[0];
        // Kept the active membership in the other building, added a pending one here.
        expect(u.units).toHaveLength(2);
        const added = u.units.find(x => x.building_id === 'bA')!;
        expect(added.status).toBe('pending');
        expect(added.is_primary).toBe(false);
        expect(u.units.find(x => x.building_id === 'bOther')!.status).toBe('active');
        // Account status untouched — still active in the other building.
        expect(u.status).toBe(UserStatus.ACTIVE);
    });
});
