import { ChargeConceptFilters, IChargeConceptRepository } from '../../domain/repository';
import {
    ChargeConcept,
    ChargeConceptKind,
    ChargeConceptStatus,
    ChargeDistribution,
} from '../../domain/entities/ChargeConcept';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabaseChargeConceptRepository implements IChargeConceptRepository {
    private toDomain(row: Record<string, unknown>): ChargeConcept {
        return new ChargeConcept({
            id: row.id as string,
            building_id: row.building_id as string,
            name: row.name as string,
            kind: row.kind as ChargeConceptKind,
            base_amount: row.base_amount === null || row.base_amount === undefined ? null : Number(row.base_amount),
            distribution: row.distribution as ChargeDistribution,
            decision_id: (row.decision_id as string | null) ?? null,
            status: row.status as ChargeConceptStatus,
            created_at: row.created_at ? new Date(row.created_at as string) : undefined,
            updated_at: row.updated_at ? new Date(row.updated_at as string) : undefined,
        });
    }

    private toPersistence(concept: ChargeConcept): Record<string, unknown> {
        return {
            id: concept.id,
            building_id: concept.building_id,
            name: concept.name,
            kind: concept.kind,
            base_amount: concept.base_amount,
            distribution: concept.distribution,
            decision_id: concept.decision_id,
            status: concept.status,
            updated_at: concept.updated_at,
        };
    }

    private raise(error: { code?: string; message: string }, concept: ChargeConcept, action: string): never {
        if (error.code === '23505') {
            throw new DomainError(`A charge concept named "${concept.name}" already exists in this building`, 'CONFLICT', 409);
        }
        throw new DomainError(`Error ${action} charge concept: ${error.message}`, 'DB_ERROR', 500);
    }

    async create(concept: ChargeConcept): Promise<ChargeConcept> {
        const { data, error } = await supabase
            .from('charge_concepts')
            .insert({ ...this.toPersistence(concept), created_at: concept.created_at })
            .select()
            .single();

        if (error) this.raise(error, concept, 'creating');
        return this.toDomain(data);
    }

    async findById(id: string): Promise<ChargeConcept | null> {
        const { data, error } = await supabase
            .from('charge_concepts')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) throw new DomainError(`Error fetching charge concept: ${error.message}`, 'DB_ERROR', 500);
        return data ? this.toDomain(data) : null;
    }

    async findByBuildingId(buildingId: string, filters: ChargeConceptFilters = {}): Promise<ChargeConcept[]> {
        let query = supabase
            .from('charge_concepts')
            .select('*')
            .eq('building_id', buildingId);
        if (filters.status) query = query.eq('status', filters.status);

        const { data, error } = await query.order('name', { ascending: true });

        if (error) throw new DomainError(`Error fetching charge concepts: ${error.message}`, 'DB_ERROR', 500);
        return (data ?? []).map(row => this.toDomain(row));
    }

    async update(concept: ChargeConcept): Promise<ChargeConcept> {
        const { data, error } = await supabase
            .from('charge_concepts')
            .update(this.toPersistence(concept))
            .eq('id', concept.id)
            .select()
            .single();

        if (error) this.raise(error, concept, 'updating');
        return this.toDomain(data);
    }
}
