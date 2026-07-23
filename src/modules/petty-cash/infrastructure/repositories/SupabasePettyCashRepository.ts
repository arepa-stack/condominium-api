import {
    PettyCashRepository,
    EntryHistoryFilters,
    EntryFilters,
} from '../../domain/repositories/PettyCashRepository';
import { PaginationFilters, toRange } from '@/core/domain/pagination';
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
        return new PettyCashFund(
            data.id,
            data.building_id,
            new Date(data.updated_at),
            data.target_fund != null ? Number(data.target_fund) : 0
        );
    }

    private entryToDomain(data: any): PettyCashEntry {
        return new PettyCashEntry({
            id: data.id,
            fund_id: data.fund_id,
            type: data.type as PettyCashEntryType,
            amount: Number(data.amount),
            original_currency: data.original_currency ?? 'USD',
            original_amount: data.original_amount != null ? Number(data.original_amount) : null,
            exchange_rate: data.exchange_rate != null ? Number(data.exchange_rate) : null,
            rate_source: data.rate_source ?? null,
            rate_date: data.rate_date ?? null,
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
            kind: (data.kind as 'GENERAL' | 'EXPRESS' | 'CONTRIBUTION') ?? 'GENERAL',
            source_entry_id: data.source_entry_id ?? null,
        });
    }

    // ── Fund ──────────────────────────────────────────────────────────────

    async findFundByBuildingId(buildingId: string): Promise<PettyCashFund | null> {
        const { data, error } = await supabase
            .from('petty_cash_fund')
            .select('id, building_id, updated_at, target_fund')
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
            .select('id, building_id, updated_at, target_fund')
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

    async getBalanceByCurrency(fundId: string): Promise<{ currency: string; balance: number }[]> {
        const { data, error } = await supabase
            .from('petty_cash_balance_by_currency')
            .select('currency, balance')
            .eq('fund_id', fundId);

        if (error) {
            throw new DomainError(
                'Error reading petty cash balance by currency: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return (data ?? []).map(r => ({ currency: r.currency as string, balance: Number(r.balance) }));
    }

    async updateFundTargetFund(fundId: string, targetFund: number): Promise<void> {
        const { error } = await supabase
            .from('petty_cash_fund')
            .update({ target_fund: targetFund })
            .eq('id', fundId);

        if (error) {
            throw new DomainError(
                'Error updating petty cash fund target: ' + error.message,
                'DB_ERROR',
                500
            );
        }
    }

    // ── Entries ───────────────────────────────────────────────────────────

    async addEntry(entry: PettyCashEntry): Promise<PettyCashEntry> {
        const persistenceData = {
            fund_id: entry.fund_id,
            type: entry.type,
            amount: entry.amount,
            original_currency: entry.original_currency,
            original_amount: entry.original_amount ?? null,
            exchange_rate: entry.exchange_rate ?? null,
            rate_source: entry.rate_source ?? null,
            rate_date: entry.rate_date ?? null,
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

    async findEntryById(entryId: string): Promise<PettyCashEntry | null> {
        const { data, error } = await supabase
            .from('petty_cash_entries')
            .select('*')
            .eq('id', entryId)
            .maybeSingle();

        if (error) {
            throw new DomainError(
                'Error fetching petty cash entry: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        if (!data) return null;
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

    async findEntriesByFundIdPaginated(
        fundId: string,
        filters: EntryFilters,
        pagination: PaginationFilters
    ): Promise<{ items: PettyCashEntry[]; total: number }> {
        const { from, to } = toRange(pagination);
        let query = supabase
            .from('petty_cash_entries')
            .select('*', { count: 'exact' })
            .eq('fund_id', fundId);

        if (filters.type) query = query.eq('type', filters.type);
        if (filters.category) query = query.eq('category', filters.category);

        query = query.order('created_at', { ascending: false }).range(from, to);

        const { data, count, error } = await query;
        if (error) {
            throw new DomainError(
                'Error fetching petty cash entries: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        return {
            items: (data ?? []).map(d => this.entryToDomain(d)),
            total: count ?? 0,
        };
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

    async findReversedOriginalIds(fundId: string): Promise<Set<string>> {
        // Select only the reference_id column to keep the payload small.
        // Filters: type = 'reversal' AND reference_type = 'reversal'
        // (PettyCashEntryType.REVERSAL = 'reversal', PettyCashEntryReferenceType.REVERSAL = 'reversal')
        const { data, error } = await supabase
            .from('petty_cash_entries')
            .select('reference_id')
            .eq('fund_id', fundId)
            .eq('type', PettyCashEntryType.REVERSAL)
            .eq('reference_type', PettyCashEntryReferenceType.REVERSAL)
            .not('reference_id', 'is', null);

        if (error) {
            throw new DomainError(
                'Error fetching reversed original ids: ' + error.message,
                'DB_ERROR',
                500
            );
        }

        const ids = new Set<string>();
        for (const row of data ?? []) {
            if (row.reference_id) ids.add(row.reference_id as string);
        }
        return ids;
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
            kind: assessment.kind,
            source_entry_id: assessment.source_entry_id ?? null,
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

    async findAssessmentById(assessmentId: string): Promise<PettyCashAssessment | null> {
        const { data, error } = await supabase
            .from('petty_cash_assessment')
            .select('*')
            .eq('id', assessmentId)
            .maybeSingle();

        if (error) {
            throw new DomainError(
                'Error fetching petty cash assessment: ' + error.message,
                'DB_ERROR',
                500
            );
        }
        if (!data) return null;
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
