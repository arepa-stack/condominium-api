-- =====================================================================
-- Rollback for 20260412081500_add_partial_status_and_indices.sql
--
-- WARNING: If any invoices are currently in 'PARTIAL' status, or any
-- unit_credit_ledger entries have negative amounts, this rollback will
-- fail because the restored constraints will reject those rows. Clean
-- up the data before running this down migration.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Guard: ensure data is compatible with the old constraints
-- ---------------------------------------------------------------------
DO $$
DECLARE
    partial_count  INT;
    negative_count INT;
BEGIN
    SELECT count(*) INTO partial_count
    FROM invoices
    WHERE status = 'PARTIAL';

    IF partial_count > 0 THEN
        RAISE EXCEPTION
          'Rollback aborted: % invoices are in PARTIAL status and would violate the old CHECK',
          partial_count;
    END IF;

    SELECT count(*) INTO negative_count
    FROM unit_credit_ledger
    WHERE amount < 0;

    IF negative_count > 0 THEN
        RAISE EXCEPTION
          'Rollback aborted: % credit ledger entries have negative amount and would violate the old CHECK',
          negative_count;
    END IF;
END $$;

-- ---------------------------------------------------------------------
-- Drop the reverse-lookup index
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS idx_credit_ledger_reference_id;

-- ---------------------------------------------------------------------
-- Restore original credit ledger CHECK (positive amounts only)
-- ---------------------------------------------------------------------
ALTER TABLE unit_credit_ledger DROP CONSTRAINT IF EXISTS unit_credit_ledger_amount_check;
ALTER TABLE unit_credit_ledger ADD CONSTRAINT unit_credit_ledger_amount_check
    CHECK (amount > 0);

-- ---------------------------------------------------------------------
-- Restore original invoice status CHECK (without PARTIAL)
-- ---------------------------------------------------------------------
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('PENDING', 'PAID', 'CANCELLED'));

COMMIT;
