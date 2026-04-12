-- =====================================================================
-- Add PARTIAL invoice status, allow negative credit ledger amounts for
-- reversals, and index reference_id for ReversePayment lookups.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Guard: validate existing data won't violate the new constraints.
-- Abort early with a clear message instead of failing mid-ALTER.
-- ---------------------------------------------------------------------
DO $$
DECLARE
    bad_invoice_count INT;
    bad_credit_count  INT;
BEGIN
    SELECT count(*) INTO bad_invoice_count
    FROM invoices
    WHERE status NOT IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED');

    IF bad_invoice_count > 0 THEN
        RAISE EXCEPTION
          'Migration aborted: % invoices have a status outside (PENDING, PARTIAL, PAID, CANCELLED)',
          bad_invoice_count;
    END IF;

    SELECT count(*) INTO bad_credit_count
    FROM unit_credit_ledger
    WHERE amount = 0;

    IF bad_credit_count > 0 THEN
        RAISE EXCEPTION
          'Migration aborted: % credit ledger entries have amount = 0',
          bad_credit_count;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Allow PARTIAL invoice status
-- ---------------------------------------------------------------------
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED'));

-- ---------------------------------------------------------------------
-- 2. Allow negative amounts in credit ledger (for reversals).
--    Zero is still rejected — a ledger entry with amount=0 is noise.
-- ---------------------------------------------------------------------
ALTER TABLE unit_credit_ledger DROP CONSTRAINT IF EXISTS unit_credit_ledger_amount_check;
ALTER TABLE unit_credit_ledger ADD CONSTRAINT unit_credit_ledger_amount_check
    CHECK (amount <> 0);

-- ---------------------------------------------------------------------
-- 3. Index for ReversePayment reverse lookups by payment id
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference_id
    ON unit_credit_ledger(reference_id);

COMMIT;
