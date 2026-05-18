import { ILeadRepository } from '../../domain/repository';
import { Lead, LeadStatus } from '../../domain/entities/Lead';

export interface ListLeadsDTO {
    status?: LeadStatus;
}

export class ListLeads {
    constructor(private leadRepo: ILeadRepository) {}

    async execute(dto?: ListLeadsDTO): Promise<Lead[]> {
        return this.leadRepo.findAll(dto?.status ? { status: dto.status } : undefined);
    }
}
