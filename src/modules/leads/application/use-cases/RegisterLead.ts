import { Lead } from '../../domain/entities/Lead';
import { ILeadRepository } from '../../domain/repository';

export interface RegisterLeadDTO {
    fullName: string;
    contact: string;
    email: string;
    buildingName: string;
    location: string;
    estimatedUsers: string;
}

export class RegisterLead {
    constructor(private leadRepository: ILeadRepository) {}

    async execute(data: RegisterLeadDTO): Promise<void> {
        const lead = Lead.create({
            full_name: data.fullName,
            contact: data.contact,
            email: data.email,
            building_name: data.buildingName,
            location: data.location,
            estimated_users: data.estimatedUsers
        });

        await this.leadRepository.save(lead);
    }
}
