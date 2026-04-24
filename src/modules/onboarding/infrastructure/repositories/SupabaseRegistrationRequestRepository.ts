import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { RegistrationRequest, RegistrationRequestProps, RegistrationRequestStatus } from '../../domain/entities/RegistrationRequest';
import { IRegistrationRequestRepository, BoardMemberInfo } from '../../domain/repository';

export class SupabaseRegistrationRequestRepository implements IRegistrationRequestRepository {
    private toDomain(data: any): RegistrationRequest {
        const props: RegistrationRequestProps = {
            id: data.id,
            building_id: data.building_id,
            unit_id: data.unit_id,
            email: data.email,
            first_name: data.first_name,
            last_name: data.last_name,
            document_id: data.document_id,
            phone: data.phone,
            source: data.source,
            invited_by_profile_id: data.invited_by_profile_id,
            invitation_id: data.invitation_id,
            status: data.status,
            created_profile_id: data.created_profile_id,
            reviewed_by_profile_id: data.reviewed_by_profile_id,
            reviewed_at: data.reviewed_at ? new Date(data.reviewed_at) : undefined,
            rejection_reason: data.rejection_reason,
            created_at: new Date(data.created_at),
        };
        return new RegistrationRequest(props);
    }

    async create(request: RegistrationRequest): Promise<RegistrationRequest> {
        const { data, error } = await supabase
            .from('registration_requests')
            .insert({
                id: request.id,
                building_id: request.building_id,
                unit_id: request.unit_id,
                email: request.email,
                first_name: request.first_name,
                last_name: request.last_name,
                document_id: request.document_id,
                phone: request.phone,
                source: request.source,
                invited_by_profile_id: request.invited_by_profile_id,
                invitation_id: request.invitation_id,
                status: request.status,
                created_at: request.created_at,
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                throw new DomainError(
                    'There is already a pending registration request for this email in this building',
                    'DUPLICATE_REQUEST',
                    409
                );
            }
            throw new DomainError('Error creating registration request: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findById(id: string): Promise<RegistrationRequest | null> {
        const { data, error } = await supabase
            .from('registration_requests')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching registration request', 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findAll(filters: {
        building_id?: string;
        status?: RegistrationRequestStatus;
    }): Promise<RegistrationRequest[]> {
        let query = supabase
            .from('registration_requests')
            .select('*')
            .order('created_at', { ascending: false });

        if (filters.building_id) query = query.eq('building_id', filters.building_id);
        if (filters.status) query = query.eq('status', filters.status);

        const { data, error } = await query;
        if (error) throw new DomainError('Error fetching registration requests', 'DB_ERROR', 500);

        return (data || []).map(d => this.toDomain(d));
    }

    async update(request: RegistrationRequest): Promise<RegistrationRequest> {
        const { data, error } = await supabase
            .from('registration_requests')
            .update({
                status: request.status,
                reviewed_by_profile_id: request.reviewed_by_profile_id,
                reviewed_at: request.reviewed_at,
                created_profile_id: request.created_profile_id,
                rejection_reason: request.rejection_reason,
            })
            .eq('id', request.id)
            .select()
            .single();

        if (error) throw new DomainError('Error updating registration request', 'DB_ERROR', 500);

        return this.toDomain(data);
    }

    async countApprovedResidentsForUnit(unitId: string): Promise<number> {
        const { count, error } = await supabase
            .from('profile_units')
            .select('*', { count: 'exact', head: true })
            .eq('unit_id', unitId);

        if (error) throw new DomainError('Error counting unit residents', 'DB_ERROR', 500);
        return count ?? 0;
    }

    async countPendingRequestsForUnit(unitId: string): Promise<number> {
        const { count, error } = await supabase
            .from('registration_requests')
            .select('*', { count: 'exact', head: true })
            .eq('unit_id', unitId)
            .eq('status', 'pending');

        if (error) throw new DomainError('Error counting pending requests', 'DB_ERROR', 500);
        return count ?? 0;
    }

    async findBoardMembersForBuilding(buildingId: string): Promise<BoardMemberInfo[]> {
        const { data, error } = await supabase
            .from('building_members')
            .select('profile_id, profiles(id, name, email)')
            .eq('building_id', buildingId)
            .eq('role', 'board');

        if (error) throw new DomainError('Error fetching board members', 'DB_ERROR', 500);

        return (data || []).map((bm: any) => ({
            profile_id: bm.profile_id,
            name: bm.profiles?.name ?? '',
            email: bm.profiles?.email ?? '',
        })).filter((bm: BoardMemberInfo) => bm.email);
    }

    async hasPendingRequestForEmail(buildingId: string, email: string): Promise<boolean> {
        const { count, error } = await supabase
            .from('registration_requests')
            .select('*', { count: 'exact', head: true })
            .eq('building_id', buildingId)
            .eq('email', email)
            .eq('status', 'pending');

        if (error) throw new DomainError('Error checking pending request', 'DB_ERROR', 500);
        return (count ?? 0) > 0;
    }
}
