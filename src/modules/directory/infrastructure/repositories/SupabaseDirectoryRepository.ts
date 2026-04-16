import { IDirectoryRepository } from '../../domain/repository';
import { BoardMember } from '../../domain/entities/BoardMember';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseDirectoryRepository implements IDirectoryRepository {
    async findBoardMembersByBuildingId(buildingId: string): Promise<BoardMember[]> {
        const { data, error } = await supabase
            .from('board_members_directory')
            .select('*')
            .eq('building_id', buildingId);

        if (error) {
            throw new DomainError('Error fetching board members: ' + error.message, 'DB_ERROR', 500);
        }

        return (data || []).map(row => new BoardMember({
            member_id: row.member_id,
            role: row.role,
            building_id: row.building_id,
            profile: {
                id: row.profile_id,
                name: row.profile_name,
                email: row.profile_email,
                phone: row.profile_phone
            },
            unit: row.unit_id ? {
                id: row.unit_id,
                name: row.unit_name
            } : undefined
        }));
    }
}
