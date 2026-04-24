import { IUnitInvitationRepository } from '../../domain/repository';
import { IBuildingRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { DomainError, NotFoundError } from '@/core/errors';

export interface InvitationMetadata {
    inviterName: string;
    unitName: string;
    buildingName: string;
    expiresAt: Date;
    isValid: boolean;
}

export class GetInvitationMetadata {
    constructor(
        private invitationRepo: IUnitInvitationRepository,
        private unitRepo: IUnitRepository,
        private buildingRepo: IBuildingRepository,
        private userRepo: IUserRepository
    ) {}

    async execute(token: string): Promise<InvitationMetadata> {
        const invitation = await this.invitationRepo.findByToken(token);
        if (!invitation) throw new NotFoundError('Invitation not found');

        if (!invitation.isPending()) {
            throw new DomainError('Invitation is no longer active', 'INVALID_INVITATION', 409);
        }

        const unit = await this.unitRepo.findById(invitation.unit_id);
        const building = await this.buildingRepo.findById(invitation.building_id);
        const inviter = await this.userRepo.findById(invitation.inviter_profile_id);

        return {
            inviterName: inviter?.name ?? 'A resident',
            unitName: unit?.name ?? '',
            buildingName: building?.name ?? '',
            expiresAt: invitation.expires_at,
            isValid: invitation.isUsable(),
        };
    }
}
