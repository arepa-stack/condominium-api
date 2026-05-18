import { ILeadRepository } from '../../domain/repository';
import { Lead, LeadStatus } from '../../domain/entities/Lead';
import { DomainError, NotFoundError } from '@/core/errors';

export interface UpdateLeadStatusDTO {
    id: string;
    status: LeadStatus;
}

export class UpdateLeadStatus {
    constructor(private leadRepo: ILeadRepository) {}

    async execute(dto: UpdateLeadStatusDTO): Promise<Lead> {
        const lead = await this.leadRepo.findById(dto.id);
        if (!lead) throw new NotFoundError('Lead not found');

        switch (dto.status) {
            case 'viewed':
                lead.markViewed();
                break;
            case 'contacted':
                lead.markContacted();
                break;
            case 'archived':
                lead.archive();
                break;
            default:
                throw new DomainError(`Invalid status transition to '${dto.status}'`, 'INVALID_STATUS', 400);
        }

        return this.leadRepo.update(lead);
    }
}
