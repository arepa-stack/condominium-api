import { IUserRepository } from '../../domain/repository';
import { ForbiddenError, NotFoundError } from '@/core/errors';
import { getBuildingScope, isBuildingInScope } from '../scope';

export interface RemoveUnitFromUserDTO {
    targetUserId: string;
    unitId: string;
    requesterId: string;
}

export class RemoveUnitFromUser {
    constructor(private userRepository: IUserRepository) { }

    async execute(dto: RemoveUnitFromUserDTO): Promise<void> {
        const requester = await this.userRepository.findById(dto.requesterId);
        if (!requester) {
            throw new NotFoundError('Requester not found');
        }
        if (!requester.isAdmin() && !requester.isBoardMember()) {
            throw new ForbiddenError('Only admins and board members can remove units');
        }

        const target = await this.userRepository.findById(dto.targetUserId);
        if (!target) {
            throw new NotFoundError('User not found');
        }

        const unit = target.units.find(u => u.unit_id === dto.unitId);
        if (!unit) {
            throw new NotFoundError('Unit not assigned to this user');
        }

        const scope = getBuildingScope(requester);
        if (!isBuildingInScope(scope, unit.building_id)) {
            throw new ForbiddenError('You do not have access to this building');
        }

        await this.userRepository.removeUnit(dto.targetUserId, dto.unitId);
    }
}
