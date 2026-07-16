import { randomUUID } from 'crypto';
import { IUnitInvitationRepository } from '../../domain/repository';
import { IBuildingRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { User } from '@/modules/users/domain/entities/User';
import { UserUnit } from '@/modules/users/domain/entities/UserUnit';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { NewRegistrationRequestEmail } from '@/infrastructure/email/templates/NewRegistrationRequestEmail';
import { UserStatus } from '@/core/domain/enums';
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

export interface PendingInvitationDTO {
    id: string;
    building_id: string;
    unit_id: string;
    email: string;
    first_name: string;
    last_name: string;
    source: 'invitation';
    status: 'pending';
    created_at: Date;
}

export class AcceptUnitInvitation {
    constructor(
        private invitationRepo: IUnitInvitationRepository,
        private unitRepo: IUnitRepository,
        private buildingRepo: IBuildingRepository,
        private authRepo: IAuthRepository,
        private userRepo: IUserRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: AcceptUnitInvitationDTO): Promise<PendingInvitationDTO> {
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

        const currentCount = await this.userRepo.countResidentsForUnit(invitation.unit_id);
        if (currentCount >= building.max_residents_per_unit) {
            throw new DomainError(
                `Unit has reached max resident capacity (${building.max_residents_per_unit})`,
                'UNIT_CAPACITY_EXCEEDED',
                409
            );
        }

        // One auth user + one profile per person across buildings. Reuse an
        // existing profile (e.g. resident of another building) and append a
        // PENDING membership; only create a new auth user for a brand-new person.
        const existing = await this.userRepo.findByEmail(invitation.invitee_email);

        let savedUser: User;
        if (existing) {
            existing.setUnits([
                ...existing.units,
                new UserUnit({
                    unit_id: invitation.unit_id,
                    building_id: invitation.building_id,
                    is_primary: false,
                    status: 'pending',
                }),
            ]);
            savedUser = await this.userRepo.update(existing);
        } else {
            // Create auth user with a random placeholder password (real creds sent upon admin approval)
            const authUser = await this.authRepo.createUser(invitation.invitee_email, randomUUID());

            const user = new User({
                id: authUser.id,
                email: invitation.invitee_email,
                name: `${dto.firstName} ${dto.lastName}`,
                phone: dto.phone,
                document_id: dto.documentId,
                source: 'invitation',
                app_role: 'user',
                status: UserStatus.PENDING,
                must_change_password: true,
            });

            user.setUnits([
                new UserUnit({
                    unit_id: invitation.unit_id,
                    building_id: invitation.building_id,
                    is_primary: currentCount === 0,
                    status: 'pending',
                }),
            ]);

            savedUser = await this.userRepo.create(user);
        }

        invitation.claim();
        await this.invitationRepo.update(invitation);

        const boardMembers = await this.userRepo.findBoardMembersForBuilding(invitation.building_id);
        await Promise.allSettled(
            boardMembers.map(async (bm) => {
                const { html, text } = await renderEmail(
                    React.createElement(NewRegistrationRequestEmail, {
                        boardMemberName: bm.name,
                        applicantName: `${dto.firstName} ${dto.lastName}`,
                        applicantEmail: invitation.invitee_email,
                        unitName: unit.name,
                        buildingName: building.name,
                        adminUrl: `${Config.APP_WEB_URL}/admin/users?status=pending`,
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

        return {
            id: savedUser.id,
            building_id: invitation.building_id,
            unit_id: invitation.unit_id,
            email: invitation.invitee_email,
            first_name: dto.firstName,
            last_name: dto.lastName,
            source: 'invitation',
            status: 'pending',
            created_at: savedUser.created_at,
        };
    }
}
