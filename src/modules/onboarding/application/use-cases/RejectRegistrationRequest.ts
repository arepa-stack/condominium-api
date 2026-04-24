import { IRegistrationRequestRepository } from '../../domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { RegistrationRejectedEmail } from '@/infrastructure/email/templates/RegistrationRejectedEmail';
import { IBuildingRepository } from '@/modules/buildings/domain/repository';
import { DomainError, ForbiddenError, NotFoundError } from '@/core/errors';
import * as React from 'react';

export interface RejectRegistrationRequestDTO {
    requestId: string;
    reviewerId: string;
    reviewerBoardBuildingIds: string[];
    reviewerAppRole: string;
    reason?: string;
}

export class RejectRegistrationRequest {
    constructor(
        private requestRepo: IRegistrationRequestRepository,
        private buildingRepo: IBuildingRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: RejectRegistrationRequestDTO): Promise<void> {
        const request = await this.requestRepo.findById(dto.requestId);
        if (!request) throw new NotFoundError('Registration request not found');
        if (!request.isPending()) {
            throw new DomainError('Registration request is not pending', 'INVALID_STATE', 409);
        }

        const isAdmin = dto.reviewerAppRole === 'admin';
        const isBoardOfBuilding = dto.reviewerBoardBuildingIds.includes(request.building_id);
        if (!isAdmin && !isBoardOfBuilding) {
            throw new ForbiddenError('You are not authorized to reject this request');
        }

        const building = await this.buildingRepo.findById(request.building_id);

        request.reject(dto.reviewerId, dto.reason);
        await this.requestRepo.update(request);

        if (building) {
            const { html, text } = await renderEmail(
                React.createElement(RegistrationRejectedEmail, {
                    name: request.full_name,
                    buildingName: building.name,
                    reason: dto.reason,
                })
            );

            await this.emailService.send({
                to: request.email,
                subject: `Solicitud de ingreso — ${building.name}`,
                html,
                text,
            });
        }
    }
}
