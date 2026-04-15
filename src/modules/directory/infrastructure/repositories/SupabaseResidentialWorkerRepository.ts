import { ResidentialWorker, ResidentialWorkerProps } from '../../domain/entities/ResidentialWorker';
import {
    IResidentialWorkerRepository,
    ResidentialWorkerListFilters,
} from '../../domain/repository';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseResidentialWorkerRepository implements IResidentialWorkerRepository {
    private toDomain(row: Record<string, unknown>): ResidentialWorker {
        const props: ResidentialWorkerProps = {
            id: row.id as string,
            building_id: row.building_id as string,
            first_name: row.first_name as string,
            last_name: row.last_name as string,
            role: row.role as string,
            phone: (row.phone as string) ?? null,
            photo_url: (row.photo_url as string) ?? null,
            work_schedule: (row.work_schedule as string) ?? null,
            is_active: row.is_active as boolean,
            created_at: new Date(row.created_at as string),
            updated_at: new Date(row.updated_at as string),
        };
        return new ResidentialWorker(props);
    }

    private toPersistence(w: ResidentialWorker): Record<string, unknown> {
        const j = w.toJSON();
        return {
            id: j.id,
            building_id: j.building_id,
            first_name: j.first_name,
            last_name: j.last_name,
            role: j.role,
            phone: j.phone,
            photo_url: j.photo_url,
            work_schedule: j.work_schedule,
            is_active: j.is_active,
            updated_at: j.updated_at,
        };
    }

    async create(worker: ResidentialWorker): Promise<ResidentialWorker> {
        const j = worker.toJSON();
        const row = {
            id: j.id,
            building_id: j.building_id,
            first_name: j.first_name,
            last_name: j.last_name,
            role: j.role,
            phone: j.phone,
            photo_url: j.photo_url,
            work_schedule: j.work_schedule,
            is_active: j.is_active,
        };

        const { data, error } = await supabase.from('residential_workers').insert(row).select().single();

        if (error) {
            throw new DomainError('Error creating worker: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toDomain(data as Record<string, unknown>);
    }

    async update(worker: ResidentialWorker): Promise<ResidentialWorker> {
        const persistence = this.toPersistence(worker);
        const { data, error } = await supabase
            .from('residential_workers')
            .update(persistence)
            .eq('id', worker.id)
            .select()
            .single();

        if (error) {
            throw new DomainError('Error updating worker: ' + error.message, 'DB_ERROR', 500);
        }
        return this.toDomain(data as Record<string, unknown>);
    }

    async findById(id: string): Promise<ResidentialWorker | null> {
        const { data, error } = await supabase.from('residential_workers').select('*').eq('id', id).single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw new DomainError('Error fetching worker', 'DB_ERROR', 500);
        }
        return this.toDomain(data as Record<string, unknown>);
    }

    async findByBuildingId(
        buildingId: string,
        filters: ResidentialWorkerListFilters = {}
    ): Promise<ResidentialWorker[]> {
        let q = supabase.from('residential_workers').select('*').eq('building_id', buildingId);

        if (filters.onlyActive === true) {
            q = q.eq('is_active', true);
        }

        const { data, error } = await q.order('role', { ascending: true }).order('last_name', { ascending: true });

        if (error) {
            throw new DomainError('Error listing workers: ' + error.message, 'DB_ERROR', 500);
        }
        return (data as Record<string, unknown>[]).map((row) => this.toDomain(row));
    }
}
