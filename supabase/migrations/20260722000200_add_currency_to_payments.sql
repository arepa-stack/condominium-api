-- Multi-currency metadata for payments. `amount` stays the CANONICAL amount in
-- the building's base unit (used by allocation/approval). These columns record
-- what the resident actually paid and the rate applied when paid in Bolívares.

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS original_currency VARCHAR(3) NOT NULL DEFAULT 'USD'
        CHECK (original_currency IN ('USD', 'VES')),
    ADD COLUMN IF NOT EXISTS original_amount DECIMAL(12, 2),
    ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18, 8),
    ADD COLUMN IF NOT EXISTS rate_source VARCHAR(20),
    ADD COLUMN IF NOT EXISTS rate_date DATE;

-- Existing rows are USD-denominated: the original amount equals the canonical amount.
UPDATE public.payments
    SET original_amount = amount
    WHERE original_amount IS NULL;
