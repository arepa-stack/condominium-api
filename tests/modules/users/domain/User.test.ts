import { describe, it, expect } from 'bun:test';
import { User, UserProps } from '@/modules/users/domain/entities/User';
import { BuildingRole } from '@/modules/users/domain/entities/BuildingRole';
import { UserStatus } from '@/core/domain/enums';

describe('User Entity', () => {
    const defaultProps: UserProps = {
        id: '123',
        email: 'test@example.com',
        name: 'Test User',
        app_role: 'user' as const,
        status: UserStatus.PENDING,
        created_at: new Date(),
        updated_at: new Date()
    };

    it('should create a user instance', () => {
        const user = new User(defaultProps);
        expect(user).toBeInstanceOf(User);
        expect(user.id).toBe('123');
    });

    it('should correctly identify admin', () => {
        const user = new User({ ...defaultProps, app_role: 'admin' as const });
        expect(user.isAdmin()).toBe(true);
        expect(user.isBoardMember()).toBe(false);
    });

    it('should correctly identify board member', () => {
        // Phase 2 semantics: board membership lives in buildingRoles (sourced
        // from building_members), not in the legacy profiles.role field. A
        // user with legacy role='board' but no building_members entries is NOT
        // a board member anywhere under the new model.
        const user = new User({
            ...defaultProps,
            app_role: 'user',
            buildingRoles: [new BuildingRole({ building_id: 'bldg-1', role: 'board' })],
        });
        expect(user.isBoardMember()).toBe(true);
        expect(user.isAdmin()).toBe(false);
    });

    it('should approve a user', () => {
        const user = new User({ ...defaultProps, status: UserStatus.PENDING });
        user.approve();
        expect(user.status).toBe(UserStatus.ACTIVE);
        expect(user.isActive()).toBe(true);
    });

    it('should not change status if already active when approving', () => {
        const user = new User({ ...defaultProps, status: UserStatus.ACTIVE });

        // Sleep small amount to ensure time diff if it were to update (won't happen in synchronous valid test usually but good to know logic)
        // actually if logic returns early, updated_at shouldn't change.

        user.approve();
        expect(user.status).toBe(UserStatus.ACTIVE);
    });

    it('should reject a user', () => {
        const user = new User({ ...defaultProps, status: UserStatus.PENDING });
        user.reject();
        expect(user.status).toBe(UserStatus.REJECTED);
    });

    it('should change app_role', () => {
        const user = new User({ ...defaultProps, app_role: 'user' as const });
        user.changeAppRole('admin');
        expect(user.app_role).toBe('admin');
        expect(user.isAdmin()).toBe(true);
    });
});
