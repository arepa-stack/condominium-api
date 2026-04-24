import { randomUUID } from 'crypto';
import { RegistrationRequest } from '../../domain/entities/RegistrationRequest';
import { IRegistrationRequestRepository } from '../../domain/repository';
import { IBuildingRepository, IUnitRepository } from '@/modules/buildings/domain/repository';
import { IEmailService } from '@/core/domain/ports/IEmailService';
import { renderEmail } from '@/infrastructure/email/templates/render';
import { NewRegistrationRequestEmail } from '@/infrastructure/email/templates/NewRegistrationRequestEmail';
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

export class SubmitRegistrationRequest {
    constructor(
        private requestRepo: IRegistrationRequestRepository,
        private buildingRepo: IBuildingRepository,
        private unitRepo: IUnitRepository,
        private emailService: IEmailService
    ) {}

    async execute(dto: SubmitRegistrationRequestDTO): Promise<RegistrationRequest> {
        const building = await this.buildingRepo.findByCode(dto.buildingCode);
        if (!building) throw new NotFoundError('Building not found');

        const unit = await this.unitRepo.findById(dto.unitId);
        if (!unit || unit.building_id !== building.id) {
            throw new DomainError('Unit does not belong to this building', 'INVALID_UNIT', 400);
        }

        const alreadyPending = await this.requestRepo.hasPendingRequestForEmail(building.id, dto.email);
        if (alreadyPending) {
            throw new DomainError(
                'There is already a pending registration request for this email',
                'DUPLICATE_REQUEST',
                409
            );
        }

        const approved = await this.requestRepo.countApprovedResidentsForUnit(dto.unitId);
        const pending = await this.requestRepo.countPendingRequestsForUnit(dto.unitId);
        if (approved + pending >= building.max_residents_per_unit) {
            throw new DomainError(
                `This unit has reached the maximum number of residents (${building.max_residents_per_unit})`,
                'UNIT_CAPACITY_EXCEEDED',
                409
            );
        }

        const request = new RegistrationRequest({
            id: randomUUID(),
            building_id: building.id,
            unit_id: dto.unitId,
            email: dto.email,
            first_name: dto.firstName,
            last_name: dto.lastName,
            document_id: dto.documentId,
            phone: dto.phone,
            source: 'qr',
            status: 'pending',
            created_at: new Date(),
        });

        const saved = await this.requestRepo.create(request);

        const boardMembers = await this.requestRepo.findBoardMembersForBuilding(building.id);
        await Promise.allSettled(
            boardMembers.map(async (bm) => {
                const { html, text } = await renderEmail(
                    React.createElement(NewRegistrationRequestEmail, {
                        boardMemberName: bm.name,
                        applicantName: `${dto.firstName} ${dto.lastName}`,
                        applicantEmail: dto.email,
                        unitName: unit.name,
                        buildingName: building.name,
                        adminUrl: `${Config.APP_WEB_URL}/admin/registration-requests/${saved.id}`,
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

        return saved;
    }
}
