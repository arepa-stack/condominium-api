import { randomUUID } from 'crypto';
import { RegistrationRequest } from '../../domain/entities/RegistrationRequest';
import { IUnitInvitationRepository, IRegistrationRequestRepository } from '../../domain/repository';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { NewRegistrationRequestEmail } from '@/infrastructure/email/templates/NewRegistrationRequestEmail';
import { IUnitRepository } from '@/modules/buildings/domain/repository';
import { DomainError, NotFoundError } from '@/core/errors';
import * as React from 'react';
import { Config } from '@/core/config';

export interface AcceptUnitInvitationDTO {
    token: string;
    firstName: string;
    lastName: string;
    documentId: string;
    phone?: string;
}

export class AcceptUnitInvitation {
    constructor(
        private invitationRepo: IUnitInvitationRepository,
        private requestRepo: IRegistrationRequestRepository,
        private unitRepo: IUnitRepository,
        private buildingRepo: IBuildingRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: AcceptUnitInvitationDTO): Promise<RegistrationRequest> {
        const invitation = await this.invitationRepo.findByToken(dto.token);
        if (!invitation) throw new NotFoundError('Invitation not found');
        if (!invitation.isUsable()) {
            throw new DomainError(
                invitation.isExpired() ? 'Invitation has expired' : 'Invitation is no longer valid',
                'INVALID_INVITATION',
                409
            );
        }

        const unit = await this.unitRepo.findById(invitation.unit_id);
        if (!unit) throw new NotFoundError('Unit not found');

        const building = await this.buildingRepo.findById(invitation.building_id);
        if (!building) throw new NotFoundError('Building not found');

        const approved = await this.requestRepo.countApprovedResidentsForUnit(invitation.unit_id);
        const pendingReqs = await this.requestRepo.countPendingRequestsForUnit(invitation.unit_id);
        if (approved + pendingReqs >= building.max_residents_per_unit) {
            throw new DomainError(
                `Unit has reached max resident capacity (${building.max_residents_per_unit})`,
                'UNIT_CAPACITY_EXCEEDED',
                409
            );
        }

        const request = new RegistrationRequest({
            id: randomUUID(),
            building_id: invitation.building_id,
            unit_id: invitation.unit_id,
            email: invitation.invitee_email,
            first_name: dto.firstName,
            last_name: dto.lastName,
            document_id: dto.documentId,
            phone: dto.phone,
            source: 'invitation',
            invited_by_profile_id: invitation.inviter_profile_id,
            invitation_id: invitation.id,
            status: 'pending',
            created_at: new Date(),
        });

        const saved = await this.requestRepo.create(request);

        invitation.claim();
        await this.invitationRepo.update(invitation);

        const boardMembers = await this.requestRepo.findBoardMembersForBuilding(invitation.building_id);
        await Promise.allSettled(
            boardMembers.map(async (bm) => {
                const { html, text } = await renderEmail(
                    React.createElement(NewRegistrationRequestEmail, {
                        boardMemberName: bm.name,
                        applicantName: `${dto.firstName} ${dto.lastName}`,
                        applicantEmail: invitation.invitee_email,
                        unitName: unit.name,
                        buildingName: building.name,
                        adminUrl: `${Config.APP_WEB_URL}/admin/registration-requests/${saved.id}`,
                    })
                );
                await this.emailService.send({
                    to: bm.email,
                    subject: `Nueva solicitud de ingreso (por invitación) — ${building.name}`,
                    html,
                    text,
                });
            })
        );

        return saved;
    }
}
