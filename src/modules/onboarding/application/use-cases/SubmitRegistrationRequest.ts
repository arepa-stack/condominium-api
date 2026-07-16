import { randomUUID } from 'crypto';
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

export interface SubmitRegistrationRequestDTO {
    buildingCode: string;
    unitId: string;
    email: string;
    firstName: string;
    lastName: string;
    documentId: string;
    phone?: string;
}

export interface PendingRegistrationDTO {
    id: string;
    building_id: string;
    unit_id: string;
    email: string;
    first_name: string;
    last_name: string;
    source: 'qr';
    status: 'pending';
    created_at: Date;
}

export class SubmitRegistrationRequest {
    constructor(
        private buildingRepo: IBuildingRepository,
        private unitRepo: IUnitRepository,
        private authRepo: IAuthRepository,
        private userRepo: IUserRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: SubmitRegistrationRequestDTO): Promise<PendingRegistrationDTO> {
        const building = await this.buildingRepo.findByCode(dto.buildingCode);
        if (!building) throw new NotFoundError('Building not found');

        const unit = await this.unitRepo.findById(dto.unitId);
        if (!unit || unit.building_id !== building.id) {
            throw new DomainError('Unit does not belong to this building', 'INVALID_UNIT', 400);
        }

        const alreadyRegistered = await this.userRepo.hasProfileForEmailInBuilding(building.id, dto.email);
        if (alreadyRegistered) {
            throw new DomainError(
                'There is already a registration for this email in this building',
                'DUPLICATE_REQUEST',
                409
            );
        }

        const currentCount = await this.userRepo.countResidentsForUnit(dto.unitId);
        if (currentCount >= building.max_residents_per_unit) {
            throw new DomainError(
                `This unit has reached the maximum number of residents (${building.max_residents_per_unit})`,
                'UNIT_CAPACITY_EXCEEDED',
                409
            );
        }

        // A person is one auth user + one profile across all buildings. If they
        // already exist (e.g. active resident of another building), reuse the
        // profile and append a PENDING membership for this building — do NOT
        // create a second auth user (Supabase would reject the duplicate email)
        // and do NOT touch the account status (that would break other buildings).
        const existing = await this.userRepo.findByEmail(dto.email);

        let savedUser: User;
        if (existing) {
            existing.setUnits([
                ...existing.units,
                new UserUnit({
                    unit_id: dto.unitId,
                    building_id: building.id,
                    is_primary: false, // already has a primary unit elsewhere
                    status: 'pending',
                }),
            ]);
            savedUser = await this.userRepo.update(existing);
        } else {
            // Brand-new person: create auth user with a random placeholder
            // password (real creds sent on approval).
            const authUser = await this.authRepo.createUser(dto.email, randomUUID());

            const user = new User({
                id: authUser.id,
                email: dto.email,
                name: `${dto.firstName} ${dto.lastName}`,
                phone: dto.phone,
                document_id: dto.documentId,
                source: 'qr',
                app_role: 'user',
                status: UserStatus.PENDING,
                must_change_password: true,
            });

            user.setUnits([
                new UserUnit({
                    unit_id: dto.unitId,
                    building_id: building.id,
                    is_primary: currentCount === 0,
                    status: 'pending',
                }),
            ]);

            savedUser = await this.userRepo.create(user);
        }

        const boardMembers = await this.userRepo.findBoardMembersForBuilding(building.id);
        await Promise.allSettled(
            boardMembers.map(async (bm) => {
                const { html, text } = await renderEmail(
                    React.createElement(NewRegistrationRequestEmail, {
                        boardMemberName: bm.name,
                        applicantName: `${dto.firstName} ${dto.lastName}`,
                        applicantEmail: dto.email,
                        unitName: unit.name,
                        buildingName: building.name,
                        adminUrl: `${Config.APP_WEB_URL}/admin/users?status=pending`,
                    })
                );
                await this.emailService.send({
                    to: bm.email,
                    subject: `Nueva solicitud de ingreso — ${building.name}`,
                    html,
                    text,
                });
            })
        );

        return {
            id: savedUser.id,
            building_id: building.id,
            unit_id: dto.unitId,
            email: dto.email,
            first_name: dto.firstName,
            last_name: dto.lastName,
            source: 'qr',
            status: 'pending',
            created_at: savedUser.created_at,
        };
    }
}
