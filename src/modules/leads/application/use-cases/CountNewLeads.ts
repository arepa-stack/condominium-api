import { ILeadRepository } from '../../domain/repository';

export class CountNewLeads {
    constructor(private leadRepo: ILeadRepository) {}

    async execute(): Promise<number> {
        return this.leadRepo.countByStatus('new');
    }
}
