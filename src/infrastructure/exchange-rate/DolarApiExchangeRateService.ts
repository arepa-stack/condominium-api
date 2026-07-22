import { Config } from '@/core/config';
import { DomainError } from '@/core/errors';
import { logger } from '@/core/logger';
import type {
    IExchangeRateService,
    ExchangeRate,
    RateSet,
    RateSource,
    ConvertInput,
    ConvertResult,
} from '@/core/domain/ports/IExchangeRateService';
import { RATE_SOURCES } from '@/core/domain/ports/IExchangeRateService';
import { SupabaseExchangeRateRepository } from './SupabaseExchangeRateRepository';

function toDateStr(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

// Raw dolarapi entry shape (both /dolares and /euros/... share it).
interface DolarApiEntry {
    moneda?: string;
    fuente?: string;     // 'oficial' | 'paralelo'
    promedio?: number;
    fechaActualizacion?: string;
}

interface FetchedRate {
    bs_per_unit: number;
    source_updated_at: string | null;
}

/**
 * Exchange-rate service backed by dolarapi.com with a Supabase table as cache.
 *
 * Read path is lazy: getRatesForDate reads the cache, fetches only what is
 * missing/stale, and never clobbers manual overrides. convert() throws a clear
 * 502 if the requested source has no value (upstream down and no cache/manual).
 */
export class DolarApiExchangeRateService implements IExchangeRateService {
    constructor(private readonly repo = new SupabaseExchangeRateRepository()) {}

    async getRatesForDate(date: string): Promise<RateSet> {
        const existing = await this.repo.findByDate(date);
        const bySource = new Map<RateSource, ExchangeRate>(existing.map(r => [r.source, r]));

        const ttlMs = Config.EXCHANGE_RATE_TTL_SECONDS * 1000;
        const now = Date.now();
        const isStale = (r: ExchangeRate) =>
            !r.is_manual && now - new Date(r.fetched_at).getTime() > ttlMs;

        const needed = RATE_SOURCES.filter(s => {
            const r = bySource.get(s);
            return !r || isStale(r);
        });

        if (needed.length > 0) {
            try {
                const fetched = await this.fetchFromApi(date);
                const rows = needed
                    // Never overwrite a manual override with API data.
                    .filter(s => !bySource.get(s)?.is_manual && fetched[s])
                    .map(s => ({
                        rate_date: date,
                        source: s,
                        bs_per_unit: fetched[s]!.bs_per_unit,
                        source_updated_at: fetched[s]!.source_updated_at,
                        is_manual: false,
                    }));
                if (rows.length > 0) {
                    await this.repo.upsert(rows);
                    // Re-read so we return canonical persisted values (with fetched_at).
                    const refreshed = await this.repo.findByDate(date);
                    bySource.clear();
                    for (const r of refreshed) bySource.set(r.source, r);
                }
            } catch (err) {
                // Graceful: fall back to whatever the cache holds. convert() will
                // surface a clear error only if the needed source is truly absent.
                logger.warn({
                    type: 'exchange_rate_fetch_failed_soft',
                    date,
                    message: (err as Error).message,
                });
            }
        }

        return this.buildSet(date, bySource);
    }

    async getLatest(): Promise<RateSet> {
        return this.getRatesForDate(toDateStr(new Date()));
    }

    async convert({ amountVes, date, source }: ConvertInput): Promise<ConvertResult> {
        const set = await this.getRatesForDate(date);
        const rate = set.rates[source];
        if (!rate) {
            throw new DomainError(
                `No exchange rate available for ${source} on ${date}`,
                'EXCHANGE_RATE_UNAVAILABLE',
                502,
            );
        }
        return {
            base: round2(amountVes / rate.bs_per_unit),
            rate: rate.bs_per_unit,
            source,
            rate_date: rate.rate_date,
        };
    }

    async refresh(date = toDateStr(new Date())): Promise<RateSet> {
        const existing = await this.repo.findByDate(date);
        const manual = new Set(existing.filter(r => r.is_manual).map(r => r.source));

        let fetched: Partial<Record<RateSource, FetchedRate>>;
        try {
            fetched = await this.fetchFromApi(date);
        } catch (err) {
            logger.error({ type: 'exchange_rate_fetch_failed', date, message: (err as Error).message });
            throw new DomainError(
                `Could not fetch exchange rates for ${date}: ${(err as Error).message}`,
                'EXCHANGE_RATE_FETCH_ERROR',
                502,
            );
        }

        const rows = RATE_SOURCES
            .filter(s => !manual.has(s) && fetched[s])
            .map(s => ({
                rate_date: date,
                source: s,
                bs_per_unit: fetched[s]!.bs_per_unit,
                source_updated_at: fetched[s]!.source_updated_at,
                is_manual: false,
            }));
        await this.repo.upsert(rows);
        return this.getRatesForDate(date);
    }

    async setManualRate(date: string, source: RateSource, bsPerUnit: number): Promise<void> {
        if (!(bsPerUnit > 0)) {
            throw new DomainError('Manual rate must be greater than 0', 'VALIDATION', 400);
        }
        await this.repo.upsert([{
            rate_date: date,
            source,
            bs_per_unit: bsPerUnit,
            source_updated_at: new Date().toISOString(),
            is_manual: true,
        }]);
    }

    // ── internals ─────────────────────────────────────────────────────────────

    private buildSet(date: string, bySource: Map<RateSource, ExchangeRate>): RateSet {
        const rates = {} as Record<RateSource, ExchangeRate | null>;
        for (const s of RATE_SOURCES) rates[s] = bySource.get(s) ?? null;
        return { rate_date: date, rates };
    }

    private async fetchFromApi(date: string): Promise<Partial<Record<RateSource, FetchedRate>>> {
        const isToday = date === toDateStr(new Date());
        const base = Config.DOLARAPI_BASE_URL;

        const dolaresUrl = isToday
            ? `${base}/v1/dolares`
            : `${base}/v1/historicos/dolares/fecha/${date}`;
        const eurosUrl = isToday
            ? `${base}/v1/euros/oficial`
            : `${base}/v1/historicos/euros/fecha/${date}`;

        const [dolares, euros] = await Promise.all([
            this.fetchJson(dolaresUrl),
            this.fetchJson(eurosUrl),
        ]);

        const out: Partial<Record<RateSource, FetchedRate>> = {};

        for (const entry of this.asArray(dolares)) {
            const rate = this.entryToRate(entry);
            if (!rate) continue;
            if (entry.fuente === 'oficial') out.dolar_oficial = rate;
            else if (entry.fuente === 'paralelo') out.dolar_paralelo = rate;
        }

        // Euro: only the official rate is tracked.
        const euroEntry = this.asArray(euros).find(e => e.fuente === 'oficial') ?? this.asArray(euros)[0];
        const euroRate = euroEntry && this.entryToRate(euroEntry);
        if (euroRate) out.euro_oficial = euroRate;

        return out;
    }

    private entryToRate(entry: DolarApiEntry): FetchedRate | null {
        if (typeof entry.promedio !== 'number' || !(entry.promedio > 0)) return null;
        return {
            bs_per_unit: entry.promedio,
            source_updated_at: entry.fechaActualizacion ?? null,
        };
    }

    private asArray(json: unknown): DolarApiEntry[] {
        if (Array.isArray(json)) return json as DolarApiEntry[];
        if (json && typeof json === 'object') return [json as DolarApiEntry];
        return [];
    }

    private async fetchJson(url: string): Promise<unknown> {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
            throw new Error(`GET ${url} → ${res.status}`);
        }
        return res.json();
    }
}
