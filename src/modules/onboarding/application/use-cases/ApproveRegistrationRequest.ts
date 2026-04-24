import { IRegistrationRequestRepository } from '../../domain/repository';
import { IBuildingRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import { IAuthRepository } from '@/modules/auth/domain/repository';
import { IUserRepository } from '@/modules/users/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { User } from '@/modules/users/domain/entities/User';
import { UserUnit } from '@/modules/users/domain/entities/UserUnit';
import { generateTempPassword } from '@/core/security/password-generator';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { ResidentApprovedEmail } from '@/infrastructure/email/templates/ResidentApprovedEmail';
import { UserStatus } from '@/core/domain/enums';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/errors';
import * as React from 'react';
import { Config } from '@/core/config';

export interface ApproveRegistrationRequestDTO {
    requestId: string;
    reviewerId: string;
    reviewerBoardBuildingIds: string[];
    reviewerAppRole: string;
}

export class ApproveRegistrationRequest {
    constructor(
        private requestRepo: IRegistrationRequestRepository,
        private buildingRepo: IBuildingRepository,
        private unitRepo: IUnitRepository,
        private authRepo: IAuthRepository,
        private userRepo: IUserRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: ApproveRegistrationRequestDTO): Promise<void> {
        const request = await this.requestRepo.findById(dto.requestId);
        if (!request) throw new NotFoundError('Registration request not found');
        if (!request.isPending()) {
            throw new DomainError('Registration request is not pending', 'INVALID_STATE', 409);
        }

        const isAdmin = dto.reviewerAppRole === 'admin';
        const isBoardOfBuilding = dto.reviewerBoardBuildingIds.includes(request.building_id);
        if (!isAdmin && !isBoardOfBuilding) {
            throw new ForbiddenError('You are not authorized to approve this request');
        }

        const building = await this.buildingRepo.findById(request.building_id);
        if (!building) throw new NotFoundError('Building not found');

        const unit = await this.unitRepo.findById(request.unit_id);
        if (!unit) throw new NotFoundError('Unit not found');

        const approved = await this.requestRepo.countApprovedResidentsForUnit(request.unit_id);
        if (approved >= building.max_residents_per_unit) {
            throw new DomainError(
                `Unit already has ${approved} resident(s), which equals the max of ${building.max_residents_per_unit}`,
                'UNIT_CAPACITY_EXCEEDED',
                409
            );
        }

        const temporaryPassword = generateTempPassword();
        const authUser = await this.authRepo.createUser(request.email, temporaryPassword);

        const existingCount = await this.requestRepo.countApprovedResidentsForUnit(request.unit_id);
        const isPrimary = existingCount === 0;

        const user = new User({
            id: authUser.id,
            email: request.email,
            name: request.full_name,
            phone: request.phone,
            app_role: 'user',
            status: UserStatus.ACTIVE,
            must_change_password: true,
        });

        user.setUnits([
            new UserUnit({
                unit_id: request.unit_id,
                building_id: request.building_id,
                is_primary: isPrimary,
            })
        ]);

        await this.userRepo.create(user);

        request.approve(dto.reviewerId, authUser.id);
        await this.requestRepo.update(request);

        const { html, text } = await renderEmail(
            React.createElement(ResidentApprovedEmail, {
                name: request.full_name,
                email: request.email,
                temporaryPassword,
                unitName: unit.name,
                buildingName: building.name,
                loginUrl: Config.APP_WEB_URL,
            })
        );

        await this.emailService.send({
            to: request.email,
            subject: `¡Fuiste aprobado! Accede a Condominio — ${building.name}`,
            html,
            text,
        });
    }
}
