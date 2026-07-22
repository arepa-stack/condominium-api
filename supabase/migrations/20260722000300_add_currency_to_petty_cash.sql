-- Multi-currency metadata for petty cash entries. `amount` stays the signed
-- CANONICAL amount (base unit) that feeds petty_cash_balance and assessments.
-- The new columns record what actually moved (physical USD vs Bolívares) and
-- the rate applied when in Bolívares.

ALTER TABLE public.petty_cash_entries
    ADD COLUMN IF NOT EXISTS original_currency VARCHAR(3) NOT NULL DEFAULT 'USD'
        CHECK (original_currency IN ('USD', 'VES')),
    ADD COLUMN IF NOT EXISTS original_amount DECIMAL(12, 2),
    ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(18, 8),
    ADD COLUMN IF NOT EXISTS rate_source VARCHAR(20),
    ADD COLUMN IF NOT EXISTS rate_date DATE;

-- Existing rows are USD-denominated: original (signed) equals canonical.
UPDATE public.petty_cash_entries
    SET original_amount = amount
    WHERE original_amount IS NULL;

-- Balance split by the currency actually held: "físico USD" vs "bolívares".
-- Sums the signed original_amount so income adds and expense subtracts per bucket.
CREATE OR REPLACE VIEW public.petty_cash_balance_by_currency AS
SELECT
    fund_id,
    original_currency AS currency,
    COALESCE(SUM(original_amount), 0) AS balance
FROM public.petty_cash_entries
GROUP BY fund_id, original_currency;

GRANT SELECT ON public.petty_cash_balance_by_currency TO authenticated;
GRANT SELECT ON public.petty_cash_balance_by_currency TO service_role;
