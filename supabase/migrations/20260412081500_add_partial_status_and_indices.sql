-- Add PARTIAL status to invoices
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
    CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED'));

-- Ensure unit_credit_ledger allows amounts (including negative for debits)
ALTER TABLE unit_credit_ledger DROP CONSTRAINT IF EXISTS unit_credit_ledger_amount_check;
ALTER TABLE unit_credit_ledger ADD CONSTRAINT unit_credit_ledger_amount_check
    CHECK (amount <> 0);

-- Add index for reverse lookup
CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference_id
    ON unit_credit_ledger(reference_id);
