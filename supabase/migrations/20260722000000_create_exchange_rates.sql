-- Exchange rates cache (Venezuela). One row per (rate_date, source).
-- Populated from dolarapi.com (lazy fetch on read) or set manually by an admin.
-- Rates are global (not per-building); any authenticated user may read them.

CREATE TABLE IF NOT EXISTS public.exchange_rates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rate_date DATE NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN ('euro_oficial', 'dolar_oficial', 'dolar_paralelo')),
    bs_per_unit DECIMAL(18, 8) NOT NULL CHECK (bs_per_unit > 0),
    source_updated_at TIMESTAMP WITH TIME ZONE,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    is_manual BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT unique_rate_date_source UNIQUE (rate_date, source)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON public.exchange_rates(rate_date);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- Writes go through the service_role client (bypasses RLS). Reads: any logged-in user.
CREATE POLICY "Authenticated can read exchange rates" ON public.exchange_rates
    FOR SELECT TO authenticated USING (true);
