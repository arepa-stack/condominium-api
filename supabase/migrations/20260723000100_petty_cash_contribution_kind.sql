-- Add CONTRIBUTION kind to petty_cash_assessment.
-- The existing CHECK on the `kind` column (added in migration 20260723000000)
-- only allows GENERAL and EXPRESS. Recreate it to include CONTRIBUTION.

ALTER TABLE public.petty_cash_assessment
    DROP CONSTRAINT IF EXISTS petty_cash_assessment_kind_check;

ALTER TABLE public.petty_cash_assessment
    ADD CONSTRAINT petty_cash_assessment_kind_check
        CHECK (kind IN ('GENERAL', 'EXPRESS', 'CONTRIBUTION'));
