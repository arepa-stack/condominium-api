export type RateSource = 'euro_oficial' | 'dolar_oficial' | 'dolar_paralelo';

export const RATE_SOURCES: RateSource[] = ['euro_oficial', 'dolar_oficial', 'dolar_paralelo'];

export interface ExchangeRate {
    source: RateSource;
    rate_date: string;        // YYYY-MM-DD
    bs_per_unit: number;      // Bolívares per 1 unit of the source currency
    source_updated_at: string | null;
    fetched_at: string;
    is_manual: boolean;
}

export interface RateSet {
    rate_date: string;
    // A source maps to null when neither the API nor a manual override has a value for that date.
    rates: Record<RateSource, ExchangeRate | null>;
}

export interface ConvertInput {
    amountVes: number;
    date: string;             // YYYY-MM-DD
    source: RateSource;
}

export interface ConvertResult {
    base: number;             // amountVes / bs_per_unit, rounded to 2 decimals
    rate: number;             // bs_per_unit applied
    source: RateSource;
    rate_date: string;
}

export interface IExchangeRateService {
    /** The 3 rates for a date, served from cache; missing ones are fetched + cached. */
    getRatesForDate(date: string): Promise<RateSet>;
    /** Convenience: rates for today. */
    getLatest(): Promise<RateSet>;
    /** Convert a Bolívares amount to the base currency of `source` for `date`. */
    convert(input: ConvertInput): Promise<ConvertResult>;
    /** Force a fresh fetch from the upstream API (does not clobber manual overrides). */
    refresh(date?: string): Promise<RateSet>;
    /** Admin manual override for one (date, source). Wins over API values. */
    setManualRate(date: string, source: RateSource, bsPerUnit: number): Promise<void>;
}
