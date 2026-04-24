import { Lead } from '../../domain/entities/Lead';
import { ILeadRepository } from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseLeadRepository implements ILeadRepository {
    async save(lead: Lead): Promise<void> {
        const persistenceData = {
            full_name: lead.full_name,
            contact: lead.contact,
            email: lead.email,
            building_name: lead.building_name,
            location: lead.location,
            estimated_users: lead.estimated_users,
            created_at: lead.created_at
        };

        const { error } = await supabase
            .from('download_requests')
            .insert(persistenceData);

        if (error) {
            throw new DomainError('Error storing download request: ' + error.message, 'DB_ERROR', 500);
        }
    }
}
