import { IUserRepository } from '../../domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';

interface SendPasswordResetDTO {
    targetId: string;
    requesterId: string;
}

export class SendPasswordReset {
    constructor(
        private userRepo: IUserRepository,
        private authRepo: IAuthRepository
    ) {}

    async execute({ targetId, requesterId }: SendPasswordResetDTO): Promise<void> {
        const requester = await this.userRepo.findById(requesterId);
        if (!requester) throw new NotFoundError('Requester not found');

        const targetUser = await this.userRepo.findById(targetId);
        if (!targetUser) throw new NotFoundError('User not found');

        const isAdmin = requester.isAdmin();
        const isBoard = requester.isBoardMember();

        if (!isAdmin && !isBoard) {
            throw new ForbiddenError('Only admins and board members can send password reset emails');
        }

        if (isBoard && !isAdmin) {
            const requesterBoardBuildings = requester.getBuildingsWhereBoard();
            const targetBuildings = new Set(targetUser.getAffiliatedBuildings());
            const hasCommonBuilding = requesterBoardBuildings.some(b => targetBuildings.has(b));

            if (!hasCommonBuilding) {
                throw new ForbiddenError('Board members can only reset passwords for users in their building');
            }
        }

        await this.authRepo.resetPasswordForEmail(targetUser.email);
    }
}
