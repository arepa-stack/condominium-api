import { Lead, LeadProps } from '../../domain/entities/Lead';
import { ILeadRepository } from '../../domain/repository';

export class RegisterLead {
    constructor(private leadRepository: ILeadRepository) {}

    async execute(data: LeadProps): Promise<void> {
        const lead = Lead.create({
            fullName: data.fullName,
            contact: data.contact,
            email: data.email,
            buildingName: data.buildingName,
            location: data.location,
            estimatedUsers: data.estimatedUsers
        });

        await this.leadRepository.save(lead);
    }
}
