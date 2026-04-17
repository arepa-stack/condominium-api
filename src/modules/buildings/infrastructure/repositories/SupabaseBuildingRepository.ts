import { Building, BuildingProps } from '../../domain/entities/Building';
import { IBuildingRepository } from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';
import { PaginationFilters, toRange } from '@/core/domain/pagination';

export class SupabaseBuildingRepository implements IBuildingRepository {
    private toDomain(data: any): Building {
        const props: BuildingProps = {
            id: data.id,
            name: data.name,
            address: data.address,
            created_at: new Date(data.created_at),
            updated_at: new Date(data.updated_at),
        };
        return new Building(props);
    }

    private toPersistence(building: Building): any {
        return {
            id: building.id,
            name: building.name,
            address: building.address,
            updated_at: building.updated_at,
        };
    }

    async create(building: Building): Promise<Building> {
        const persistenceData = {
            ...this.toPersistence(building),
            created_at: building.created_at,
        };

        const { data, error } = await supabase
            .from('buildings')
            .insert(persistenceData)
            .select()
            .single();

        if (error) {
            throw new DomainError('Error creating building: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async findAll(): Promise<Building[]> {
        const { data, error } = await supabase
            .from('buildings')
            .select('*')
            .order('name', { ascending: true });

        if (error) {
            throw new DomainError('Error fetching buildings: ' + error.message, 'DB_ERROR', 500);
        }

        return data.map(this.toDomain);
    }

    async findAllPaginated(
        pagination: PaginationFilters
    ): Promise<{ items: Building[]; total: number }> {
        const { from, to } = toRange(pagination);
        const { data, count, error } = await supabase
            .from('buildings')
            .select('*', { count: 'exact' })
            .order('name', { ascending: true })
            .range(from, to);

        if (error) {
            throw new DomainError('Error fetching buildings: ' + error.message, 'DB_ERROR', 500);
        }

        return {
            items: (data || []).map(d => this.toDomain(d)),
            total: count || 0,
        };
    }

    async findById(id: string): Promise<Building | null> {
        const { data, error } = await supabase
            .from('buildings')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching building', 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async update(building: Building): Promise<Building> {
        const persistenceData = this.toPersistence(building);

        const { data, error } = await supabase
            .from('buildings')
            .update(persistenceData)
            .eq('id', building.id)
            .select()
            .single();

        if (error) {
            throw new DomainError('Error updating building: ' + error.message, 'DB_ERROR', 500);
        }

        return this.toDomain(data);
    }

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('buildings')
            .delete()
            .eq('id', id);

        if (error) {
            throw new DomainError('Error deleting building: ' + error.message, 'DB_ERROR', 500);
        }
    }
}
