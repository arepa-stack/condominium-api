import { Lead, LeadProps, LeadStatus } from '../../domain/entities/Lead';
import { ILeadRepository } from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseLeadRepository implements ILeadRepository {
    private toDomain(data: any): Lead {
        return Lead.create({
            id: data.id,
            full_name: data.full_name,
            contact: data.contact,
            email: data.email,
            building_name: data.building_name,
            location: data.location,
            estimated_users: data.estimated_users,
            status: data.status ?? 'new',
            viewed_at: data.viewed_at ? new Date(data.viewed_at) : undefined,
            contacted_at: data.contacted_at ? new Date(data.contacted_at) : undefined,
            created_at: new Date(data.created_at),
        });
    }

    async save(lead: Lead): Promise<void> {
        const { error } = await supabase
            .from('download_requests')
            .insert({
                full_name: lead.full_name,
                contact: lead.contact,
                email: lead.email,
                building_name: lead.building_name,
                location: lead.location,
                estimated_users: lead.estimated_users,
                status: lead.status,
                created_at: lead.created_at,
            });

        if (error) {
            throw new DomainError('Error storing download request: ' + error.message, 'DB_ERROR', 500);
        }
    }

    async findAll(filters?: { status?: LeadStatus }): Promise<Lead[]> {
        let query = supabase
            .from('download_requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (filters?.status) {
            query = query.eq('status', filters.status);
        }

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching leads: ' + error.message, 'DB_ERROR', 500);

        return (data || []).map((d: any) => this.toDomain(d));
    }

    async findById(id: string): Promise<Lead | null> {
        const { data, error } = await supabase
            .from('download_requests')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching lead: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async update(lead: Lead): Promise<Lead> {
        const { data, error } = await supabase
            .from('download_requests')
            .update({
                status: lead.status,
                viewed_at: lead.viewed_at ?? null,
                contacted_at: lead.contacted_at ?? null,
            })
            .eq('id', lead.id!)
            .select()
            .single();

        if (error) throw new DomainError('Error updating lead: ' + error.message, 'DB_ERROR', 500);

        return this.toDomain(data);
    }

    async countByStatus(status: LeadStatus): Promise<number> {
        const { count, error } = await supabase
            .from('download_requests')
            .select('*', { count: 'exact', head: true })
            .eq('status', status);

        if (error) throw new DomainError('Error counting leads: ' + error.message, 'DB_ERROR', 500);
        return count ?? 0;
    }
}
