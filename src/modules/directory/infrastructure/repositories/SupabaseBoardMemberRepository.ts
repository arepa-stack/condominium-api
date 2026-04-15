import { BoardMember, BoardMemberProps } from '../../domain/entities/BoardMember';
import {
    IBoardMemberRepository,
    BoardMemberListFilters,
} from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseBoardMemberRepository implements IBoardMemberRepository {
    private toDomain(row: Record<string, unknown>): BoardMember {
        const props: BoardMemberProps = {
            id: row.id as string,
            building_id: row.building_id as string,
            first_name: row.first_name as string,
            last_name: row.last_name as string,
            role: row.role as string,
            phone: (row.phone as string) ?? null,
            email: (row.email as string) ?? null,
            apartment_number: (row.apartment_number as string) ?? null,
            photo_url: (row.photo_url as string) ?? null,
            is_active: row.is_active as boolean,
            is_current_board: row.is_current_board as boolean,
            profile_id: (row.profile_id as string) ?? null,
            created_at: new Date(row.created_at as string),
            updated_at: new Date(row.updated_at as string),
        };
        return new BoardMember(props);
    }

    private toPersistence(m: BoardMember): Record<string, unknown> {
        const j = m.toJSON();
        return {
            id: j.id,
            building_id: j.building_id,
            first_name: j.first_name,
            last_name: j.last_name,
            role: j.role,
            phone: j.phone,
            email: j.email,
            apartment_number: j.apartment_number,
            photo_url: j.photo_url,
            is_active: j.is_active,
            is_current_board: j.is_current_board,
            profile_id: j.profile_id ?? null,
            updated_at: j.updated_at,
        };
    }

    async create(member: BoardMember): Promise<BoardMember> {
        const j = member.toJSON();
        const row = {
            id: j.id,
            building_id: j.building_id,
            first_name: j.first_name,
            last_name: j.last_name,
            role: j.role,
            phone: j.phone,
            email: j.email,
            apartment_number: j.apartment_number,
            photo_url: j.photo_url,
            is_active: j.is_active,
            is_current_board: j.is_current_board,
            profile_id: j.profile_id ?? null,
        };

        const { data, error } = await supabase.from('board_members').insert(row).select().single();

        if (error) {
            throw new DomainError('Error creating board member: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toDomain(data as Record<string, unknown>);
    }

    async update(member: BoardMember): Promise<BoardMember> {
        const persistence = this.toPersistence(member);
        const { data, error } = await supabase
            .from('board_members')
            .update(persistence)
            .eq('id', member.id)
            .select()
            .single();

        if (error) {
            throw new DomainError('Error updating board member: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toDomain(data as Record<string, unknown>);
    }

    async findById(id: string): Promise<BoardMember | null> {
        const { data, error } = await supabase.from('board_members').select('*').eq('id', id).single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching board member', 'DB_ERROR', 500);
        }
        return this.toDomain(data as Record<string, unknown>);
    }

    async findByProfileAndBuilding(
        profileId: string,
        buildingId: string
    ): Promise<BoardMember | null> {
        const { data, error } = await supabase
            .from('board_members')
            .select('*')
            .eq('profile_id', profileId)
            .eq('building_id', buildingId)
            .maybeSingle();

        if (error) {
            throw new DomainError(
                'Error fetching board member by profile: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        if (!data) return null;
        return this.toDomain(data as Record<string, unknown>);
    }

    async findByBuildingId(
        buildingId: string,
        filters: BoardMemberListFilters = {}
    ): Promise<BoardMember[]> {
        let q = supabase.from('board_members').select('*').eq('building_id', buildingId);

        if (filters.onlyActive === true) {
            q = q.eq('is_active', true);
        }
        if (filters.onlyCurrentBoard === true) {
            q = q.eq('is_current_board', true);
        }

        const { data, error } = await q.order('role', { ascending: true }).order('last_name', { ascending: true });

        if (error) {
            throw new DomainError('Error listing board members: ' + error.message, 'DB_ERROR', 500);
        }
        return (data as Record<string, unknown>[]).map((row) => this.toDomain(row));
    }
}
