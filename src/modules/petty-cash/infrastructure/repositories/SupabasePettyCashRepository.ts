import {
    PettyCashRepository,
    EntryHistoryFilters,
} from '../../domain/repositories/PettyCashRepository';
import { PettyCashFund } from '../../domain/entities/PettyCashFund';
import { PettyCashEntry } from '../../domain/entities/PettyCashEntry';
import { PettyCashAssessment } from '../../domain/entities/PettyCashAssessment';
import {
    PettyCashEntryType,
    PettyCashEntryReferenceType,
    PettyCashCategory,
} from '@/core/domain/enums';
import { supabaseAdmin as supabase } from '@/infrastructure/supabase';
import { DomainError } from '@/core/errors';

export class SupabasePettyCashRepository implements PettyCashRepository {
    // ── Mapping helpers ───────────────────────────────────────────────────

    private fundToDomain(data: any): PettyCashFund {
        // Phase 2 doesn't drop the legacy columns yet (that's Phase 3),
        // so current_balance + currency are still in the row. We ignore
        // them and use the balance view instead; currency is hardcoded
        // here until the column is removed.
        return new PettyCashFund(
            data.id,
            data.building_id,
            0,                // legacy field — irrelevant; view is the truth
            'VES',            // legacy field — dropped in Phase 3
            new Date(data.updated_at)
        );
    }

    private entryToDomain(data: any): PettyCashEntry {
        return new PettyCashEntry({
            id: data.id,
            fund_id: data.fund_id,
            type: data.type as PettyCashEntryType,
            amount: Number(data.amount),
            category: (data.category as PettyCashCategory) ?? null,
            description: data.description,
            evidence_url: data.evidence_url ?? null,
            reference_type:
                (data.reference_type as PettyCashEntryReferenceType) ?? null,
            reference_id: data.reference_id ?? null,
            created_by: data.created_by,
            created_at: new Date(data.created_at),
        });
    }

    private assessmentToDomain(data: any): PettyCashAssessment {
        return new PettyCashAssessment({
            id: data.id,
            fund_id: data.fund_id,
            period: data.period,
            description: data.description,
            category: (data.category as PettyCashCategory) ?? null,
            total_amount: Number(data.total_amount),
            created_by: data.created_by,
            created_at: new Date(data.created_at),
        });
    }

    // ── Fund ──────────────────────────────────────────────────────────────

    async findFundByBuildingId(buildingId: string): Promise<PettyCashFund | null> {
        const { data, error } = await supabase
            .from('petty_cash_fund')
            .select('id, building_id, updated_at')
            .eq('building_id', buildingId)
            .maybeSingle();

        if (error) {
            throw new DomainError(
                'Error fetching petty cash fund: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        if (!data) return null;
        return this.fundToDomain(data);
    }

    async findOrCreateFund(buildingId: string): Promise<PettyCashFund> {
        // Upsert on building_id (UNIQUE constraint). Works as both
        // insert-if-missing and no-op on race. Phase 1 left the legacy
        // current_balance column in place with a DEFAULT 0, so the
        // upsert only needs to set building_id.
        const { data, error } = await supabase
            .from('petty_cash_fund')
            .upsert(
                { building_id: buildingId },
                { onConflict: 'building_id', ignoreDuplicates: false }
            )
            .select('id, building_id, updated_at')
            .single();

        if (error) {
            throw new DomainError(
                'Error creating petty cash fund: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return this.fundToDomain(data);
    }

    async getBalance(fundId: string): Promise<number> {
        const { data, error } = await supabase
            .from('petty_cash_balance')
            .select('balance')
            .eq('fund_id', fundId)
            .maybeSingle();

        if (error) {
            throw new DomainError(
                'Error reading petty cash balance: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        if (!data) return 0;
        return Number(data.balance);
    }

    // ── Entries ───────────────────────────────────────────────────────────

    async addEntry(entry: PettyCashEntry): Promise<PettyCashEntry> {
        const persistenceData = {
            fund_id: entry.fund_id,
            type: entry.type,
            amount: entry.amount,
            category: entry.category ?? null,
            description: entry.description,
            evidence_url: entry.evidence_url ?? null,
            reference_type: entry.reference_type ?? null,
            reference_id: entry.reference_id ?? null,
            created_by: entry.created_by,
        };

        const { data, error } = await supabase
            .from('petty_cash_entries')
            .insert(persistenceData)
            .select('*')
            .single();

        if (error) {
            throw new DomainError(
                'Error saving petty cash entry: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return this.entryToDomain(data);
    }

    async findEntriesByFundId(
        fundId: string,
        filters: EntryHistoryFilters
    ): Promise<PettyCashEntry[]> {
        let query = supabase
            .from('petty_cash_entries')
            .select('*')
            .eq('fund_id', fundId);

        if (filters.type) query = query.eq('type', filters.type);
        if (filters.category) query = query.eq('category', filters.category);

        query = query.order('created_at', { ascending: false });

        if (filters.offset || filters.limit) {
            const offset = filters.offset ?? 0;
            const limit = filters.limit ?? 50;
            query = query.range(offset, offset + limit - 1);
        } else if (filters.limit) {
            query = query.limit(filters.limit);
        }

        const { data, error } = await query;
        if (error) {
            throw new DomainError(
                'Error fetching petty cash entries: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return (data ?? []).map(d => this.entryToDomain(d));
    }

    async findEntriesByReference(
        referenceType: string,
        referenceId: string
    ): Promise<PettyCashEntry[]> {
        const { data, error } = await supabase
            .from('petty_cash_entries')
            .select('*')
            .eq('reference_type', referenceType)
            .eq('reference_id', referenceId);

        if (error) {
            throw new DomainError(
                'Error fetching entries by reference: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return (data ?? []).map(d => this.entryToDomain(d));
    }

    // ── Assessment ────────────────────────────────────────────────────────

    async createAssessment(
        assessment: PettyCashAssessment
    ): Promise<PettyCashAssessment> {
        const persistenceData = {
            fund_id: assessment.fund_id,
            period: assessment.period,
            description: assessment.description,
            category: assessment.category ?? null,
            total_amount: assessment.total_amount,
            created_by: assessment.created_by,
        };

        const { data, error } = await supabase
            .from('petty_cash_assessment')
            .insert(persistenceData)
            .select('*')
            .single();

        if (error) {
            throw new DomainError(
                'Error creating petty cash assessment: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return this.assessmentToDomain(data);
    }

    async findAssessmentsByFundId(fundId: string): Promise<PettyCashAssessment[]> {
        const { data, error } = await supabase
            .from('petty_cash_assessment')
            .select('*')
            .eq('fund_id', fundId)
            .order('created_at', { ascending: false });

        if (error) {
            throw new DomainError(
                'Error fetching assessments: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return (data ?? []).map(d => this.assessmentToDomain(d));
    }

    async findAssessmentsByPeriod(
        fundId: string,
        period: string
    ): Promise<PettyCashAssessment[]> {
        const { data, error } = await supabase
            .from('petty_cash_assessment')
            .select('*')
            .eq('fund_id', fundId)
            .eq('period', period)
            .order('created_at', { ascending: false });

        if (error) {
            throw new DomainError(
                'Error fetching assessments by period: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return (data ?? []).map(d => this.assessmentToDomain(d));
    }
}
