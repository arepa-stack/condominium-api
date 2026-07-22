import { supabaseAdmin } from '@/infrastructure/supabase';
import { logger } from '@/core/logger';
import type { ExchangeRate, RateSource } from '@/core/domain/ports/IExchangeRateService';

interface ExchangeRateRow {
    rate_date: string;
    source: RateSource;
    bs_per_unit: number;
    source_updated_at: string | null;
    is_manual: boolean;
}

function toDomain(data: any): ExchangeRate {
    return {
        source: data.source,
        rate_date: data.rate_date,
        bs_per_unit: Number(data.bs_per_unit),
        source_updated_at: data.source_updated_at ?? null,
        fetched_at: data.fetched_at,
        is_manual: !!data.is_manual,
    };
}

/**
 * Persistence for the exchange_rates cache table. Writes use the service_role
 * client (bypasses RLS). Upserts key on the (rate_date, source) unique constraint.
 */
export class SupabaseExchangeRateRepository {
    async findByDate(date: string): Promise<ExchangeRate[]> {
        const { data, error } = await supabaseAdmin
            .from('exchange_rates')
            .select('*')
            .eq('rate_date', date);
        if (error) {
            logger.error({ type: 'exchange_rate_read_failed', date, message: error.message });
            return [];
        }
        return (data ?? []).map(toDomain);
    }

    async upsert(rows: ExchangeRateRow[]): Promise<void> {
        if (rows.length === 0) return;
        const { error } = await supabaseAdmin
            .from('exchange_rates')
            .upsert(
                rows.map(r => ({
                    rate_date: r.rate_date,
                    source: r.source,
                    bs_per_unit: r.bs_per_unit,
                    source_updated_at: r.source_updated_at,
                    is_manual: r.is_manual,
                    fetched_at: new Date().toISOString(),
                })),
                { onConflict: 'rate_date,source' }
            );
        if (error) {
            logger.error({ type: 'exchange_rate_write_failed', message: error.message });
            throw error;
        }
    }
}
