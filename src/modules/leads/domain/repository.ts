import { Lead } from './entities/Lead';

export interface ILeadRepository {
    save(lead: Lead): Promise<void>;
}
