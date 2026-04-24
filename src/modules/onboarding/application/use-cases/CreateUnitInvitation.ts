import { randomUUID, randomBytes } from 'crypto';
import { UnitInvitation } from '../../domain/entities/UnitInvitation';
import { IUnitInvitationRepository, IRegistrationRequestRepository } from '../../domain/repository';
import { IBuildingRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { UnitInvitationEmail } from '@/infrastructure/email/templates/UnitInvitationEmail';
import { DomainError, NotFoundError } from '@/core/errors';
import * as React from 'react';
import { Config } from '@/core/config';

export interface CreateUnitInvitationDTO {
    inviterProfileId: string;
    inviteeEmail: string;
    inviteeName?: string;
}

export class CreateUnitInvitation {
    constructor(
        private invitationRepo: IUnitInvitationRepository,
        private requestRepo: IRegistrationRequestRepository,
        private userRepo: IUserRepository,
        private unitRepo: IUnitRepository,
        private buildingRepo: IBuildingRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: CreateUnitInvitationDTO): Promise<UnitInvitation> {
        const inviter = await this.userRepo.findById(dto.inviterProfileId);
        if (!inviter) throw new NotFoundError('Inviter profile not found');

        const primaryUnit = inviter.primaryUnit;
        if (!primaryUnit) {
            throw new DomainError('You do not have a unit assigned', 'NO_UNIT', 400);
        }

        const unit = await this.unitRepo.findById(primaryUnit.unit_id);
        if (!unit) throw new NotFoundError('Unit not found');

        const building = await this.buildingRepo.findById(unit.building_id);
        if (!building) throw new NotFoundError('Building not found');

        const approved = await this.requestRepo.countApprovedResidentsForUnit(unit.id);
        const pendingRequests = await this.requestRepo.countPendingRequestsForUnit(unit.id);
        const pendingInvitations = await this.invitationRepo.countPendingInvitationsForUnit(unit.id);
        const total = approved + pendingRequests + pendingInvitations;

        if (total >= building.max_residents_per_unit) {
            throw new DomainError(
                `This unit has reached the maximum resident capacity (${building.max_residents_per_unit})`,
                'UNIT_CAPACITY_EXCEEDED',
                409
            );
        }

        const token = randomBytes(24).toString('base64url');
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + Config.INVITATION_EXPIRES_DAYS);

        const invitation = new UnitInvitation({
            id: randomUUID(),
            unit_id: unit.id,
            building_id: building.id,
            inviter_profile_id: dto.inviterProfileId,
            invitee_email: dto.inviteeEmail,
            invitee_name: dto.inviteeName,
            token,
            status: 'pending',
            expires_at: expiresAt,
            created_at: new Date(),
        });

        const saved = await this.invitationRepo.create(invitation);

        const acceptUrl = `${Config.APP_WEB_URL}/join?inv=${token}`;
        const { html, text } = await renderEmail(
            React.createElement(UnitInvitationEmail, {
                inviterName: inviter.name,
                inviteeName: dto.inviteeName,
                unitName: unit.name,
                buildingName: building.name,
                acceptUrl,
                expiresAt,
            })
        );

        await this.emailService.send({
            to: dto.inviteeEmail,
            subject: `Te invitaron a unirte a ${building.name} — Condominio`,
            html,
            text,
        });

        return saved;
    }
}
