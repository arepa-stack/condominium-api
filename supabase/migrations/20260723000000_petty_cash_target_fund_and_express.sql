-- Petty-cash recovery model: additive columns for target fund,
-- assessment kind, and source entry linking.

ALTER TABLE public.petty_cash_fund
    ADD COLUMN IF NOT EXISTS target_fund DECIMAL(12, 2) NOT NULL DEFAULT 0
        CHECK (target_fund >= 0);

ALTER TABLE public.petty_cash_assessment
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'GENERAL'
        CHECK (kind IN ('GENERAL', 'EXPRESS'));

ALTER TABLE public.petty_cash_assessment
    ADD COLUMN IF NOT EXISTS source_entry_id UUID NULL
        REFERENCES public.petty_cash_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_petty_cash_assessment_source_entry
    ON public.petty_cash_assessment(source_entry_id)
    WHERE source_entry_id IS NOT NULL;
