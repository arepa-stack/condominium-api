-- =====================================================================
-- Drop invoice status recalculation triggers — move ownership to domain.
--
-- Context:
--   The repo previously relied on two Postgres triggers to keep
--   invoices.paid_amount and invoices.status in sync with
--   payment_allocations and payments.status:
--     - trigger_update_invoice_status (on payment_allocations)
--     - trigger_update_invoices_on_payment_status_change (on payments)
--
--   Both delegated to update_invoice_status_for_id(UUID), which
--   recalculated paid_amount as SUM(allocations WHERE payment.status
--   = 'APPROVED') and set status accordingly.
--
-- Architectural decision (Camino 2):
--   The application code (Invoice aggregate + ApprovePayment /
--   ReversePayment / ProcessInvoiceOverpayment use cases) now owns
--   paid_amount and status recalculation. Domain-owned state is
--   testable without a real database, makes the business rules
--   explicit in TypeScript, and removes the race condition of having
--   two writers (domain + trigger) target the same rows.
--
-- Trade-off:
--   Integrity invariants that the trigger guaranteed at the DB level
--   now depend on the application code running the right sequence of
--   addPayment/subtractPayment + updateStatus + allocation delete.
--   If someone writes directly to the tables (SQL console, admin
--   script, another service) those invariants will not be enforced.
--   Mitigated by keeping the allocation repository as the only insert
--   path and by having domain-level tests.
-- =====================================================================

BEGIN;

DROP TRIGGER IF EXISTS trigger_update_invoices_on_payment_status_change
    ON public.payments;

DROP TRIGGER IF EXISTS trigger_update_invoice_status
    ON public.payment_allocations;

DROP FUNCTION IF EXISTS update_invoices_on_payment_status_change();
DROP FUNCTION IF EXISTS update_invoice_status();
DROP FUNCTION IF EXISTS update_invoice_status_for_id(UUID);

COMMIT;
