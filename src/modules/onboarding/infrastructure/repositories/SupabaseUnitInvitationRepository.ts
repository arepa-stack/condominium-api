import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { UnitInvitation, UnitInvitationProps } from '../../domain/entities/UnitInvitation';
import { IUnitInvitationRepository } from '../../domain/repository';

export class SupabaseUnitInvitationRepository implements IUnitInvitationRepository {
    private toDomain(data: any): UnitInvitation {
        const props: UnitInvitationProps = {
            id: data.id,
            unit_id: data.unit_id,
            building_id: data.building_id,
            inviter_profile_id: data.inviter_profile_id,
            invitee_email: data.invitee_email,
            invitee_name: data.invitee_name,
            token: data.token,
            status: data.status,
            expires_at: new Date(data.expires_at),
            claimed_at: data.claimed_at ? new Date(data.claimed_at) : undefined,
            created_at: new Date(data.created_at),
        };
        return new UnitInvitation(props);
    }

    async create(invitation: UnitInvitation): Promise<UnitInvitation> {
        const { data, error } = await supabase
            .from('unit_invitations')
            .insert({
                id: invitation.id,
                unit_id: invitation.unit_id,
                building_id: invitation.building_id,
                inviter_profile_id: invitation.inviter_profile_id,
                invitee_email: invitation.invitee_email,
                invitee_name: invitation.invitee_name,
                token: invitation.token,
                status: invitation.status,
                expires_at: invitation.expires_at,
                created_at: invitation.created_at,
            })
            .select()
            .single();

        if (error) throw new DomainError('Error creating unit invitation: ' + error.message, 'DB_ERROR', 500);

        return this.toDomain(data);
    }

    async findById(id: string): Promise<UnitInvitation | null> {
        const { data, error } = await supabase
            .from('unit_invitations')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching invitation', 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findByToken(token: string): Promise<UnitInvitation | null> {
        const { data, error } = await supabase
            .from('unit_invitations')
            .select('*')
            .eq('token', token)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching invitation by token', 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findByInviter(inviterProfileId: string): Promise<UnitInvitation[]> {
        const { data, error } = await supabase
            .from('unit_invitations')
            .select('*')
            .eq('inviter_profile_id', inviterProfileId)
            .order('created_at', { ascending: false });

        if (error) throw new DomainError('Error fetching invitations', 'DB_ERROR', 500);

        return (data || []).map(d => this.toDomain(d));
    }

    async update(invitation: UnitInvitation): Promise<UnitInvitation> {
        const { data, error } = await supabase
            .from('unit_invitations')
            .update({
                status: invitation.status,
                claimed_at: invitation.claimed_at,
            })
            .eq('id', invitation.id)
            .select()
            .single();

        if (error) throw new DomainError('Error updating invitation', 'DB_ERROR', 500);

        return this.toDomain(data);
    }

    async countPendingInvitationsForUnit(unitId: string): Promise<number> {
        const { count, error } = await supabase
            .from('unit_invitations')
            .select('*', { count: 'exact', head: true })
            .eq('unit_id', unitId)
            .eq('status', 'pending')
            .gt('expires_at', new Date().toISOString());

        if (error) throw new DomainError('Error counting pending invitations', 'DB_ERROR', 500);
        return count ?? 0;
    }
}
