import { IUserRepository } from '../../domain/repository';
import { User, UserProps } from '../../domain/entities/User';
import { AppRole } from '@/core/domain/enums';
import { ForbiddenError, NotFoundError } from '@/core/errors';

interface UpdateUserDTO {
    id: string;
    updaterId: string;
    data: Partial<Omit<UserProps, 'id' | 'email' | 'created_at' | 'updated_at'>>;
}

export class UpdateUser {
    constructor(private userRepo: IUserRepository) { }

    async execute({ id, updaterId, data }: UpdateUserDTO): Promise<User> {
        const updater = await this.userRepo.findById(updaterId);
        if (!updater) throw new NotFoundError('Updater not found');

        const targetUser = await this.userRepo.findById(id);
        if (!targetUser) throw new NotFoundError('User not found');

        const isSelfUpdate = id === updaterId;
        const isAdmin = updater.isAdmin();
        const isBoard = updater.isBoardMember();

        if (!isSelfUpdate) {
            if (!isAdmin && !isBoard) {
                throw new ForbiddenError('You can only update your own profile');
            }
            if (isBoard) {
                // Requester authority: strictly buildings where they are board.
                // Target reachability: any affiliation (unit or board role).
                const updaterBoardBuildings = updater.getBuildingsWhereBoard();
                const targetBuildings = new Set(targetUser.getAffiliatedBuildings());
                const hasCommonBuilding = updaterBoardBuildings.some(b => targetBuildings.has(b));

                if (!hasCommonBuilding) {
                    throw new ForbiddenError('Board members can only update users in their building');
                }
            }
        }

        // Global-capability change (app_role): admin-only.
        if (data.app_role && data.app_role !== targetUser.app_role) {
            if (!isAdmin) {
                throw new ForbiddenError('Only admins can change a user app_role');
            }
            targetUser.changeAppRole(data.app_role as AppRole);
        }

        targetUser.updateProfile(data);

        return await this.userRepo.update(targetUser);
    }
}
