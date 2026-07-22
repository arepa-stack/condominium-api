-- Per-building default exchange-rate source. This is the canonical rate used to
-- convert Bolívares into the building's base unit for payments and petty cash.
-- Values: euro_oficial | dolar_oficial | dolar_paralelo.

ALTER TABLE public.buildings
    ADD COLUMN IF NOT EXISTS default_rate_source VARCHAR(20) NOT NULL DEFAULT 'dolar_oficial'
    CHECK (default_rate_source IN ('euro_oficial', 'dolar_oficial', 'dolar_paralelo'));
