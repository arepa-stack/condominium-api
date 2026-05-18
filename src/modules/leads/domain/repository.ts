import { Lead, LeadStatus } from './entities/Lead';

export interface ILeadRepository {
    save(lead: Lead): Promise<void>;
    findAll(filters?: { status?: LeadStatus }): Promise<Lead[]>;
    findById(id: string): Promise<Lead | null>;
    update(lead: Lead): Promise<Lead>;
    countByStatus(status: LeadStatus): Promise<number>;
}
