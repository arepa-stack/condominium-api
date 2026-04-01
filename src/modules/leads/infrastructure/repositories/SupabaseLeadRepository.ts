import { Lead } from '../../domain/entities/Lead';
import { ILeadRepository } from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseLeadRepository implements ILeadRepository {
    async save(lead: Lead): Promise<void> {
        const persistenceData = {
            full_name: lead.fullName,
            contact: lead.contact,
            email: lead.email,
            building_name: lead.buildingName,
            location: lead.location,
            estimated_users: lead.estimatedUsers,
            created_at: lead.createdAt
        };

        const { error } = await supabase
            .from('download_requests')
            .insert(persistenceData);

        if (error) {
            throw new DomainError('Error storing download request: ' + error.message, 'DB_ERROR', 500);
        }
    }
}
