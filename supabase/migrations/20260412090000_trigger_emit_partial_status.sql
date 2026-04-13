-- =====================================================================
-- Teach the invoice status triggers to emit PARTIAL.
--
-- Context:
--   20260204140000_simplify_invoice_status.sql removed PARTIALLY_PAID and
--   left the trigger functions emitting only PENDING/PAID.
--   20260412081500_add_partial_status_and_indices.sql re-introduced
--   PARTIAL at the CHECK level but did NOT update the trigger functions,
--   so any domain-level write setting status='PARTIAL' is silently
--   overwritten the next time a payment_allocation or payment.status
--   change fires the trigger.
--
-- This migration fixes the functions so they emit PARTIAL when
-- total_paid > 0 AND total_paid < invoice_total, making PARTIAL a
-- real, observable state in the data.
--
-- Scope: defensive. Does not touch the architectural question of
-- whether the triggers or the domain should own status recalculation.
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION update_invoice_status_for_id(p_invoice_id UUID)
RETURNS VOID AS $$
DECLARE
    total_paid    NUMERIC;
    invoice_total NUMERIC;
BEGIN
    SELECT COALESCE(SUM(pa.amount), 0) INTO total_paid
    FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    WHERE pa.invoice_id = p_invoice_id
      AND p.status = 'APPROVED';

    SELECT amount INTO invoice_total
    FROM public.invoices
    WHERE id = p_invoice_id;

    IF total_paid >= invoice_total THEN
        UPDATE public.invoices
           SET status = 'PAID', paid_amount = total_paid
         WHERE id = p_invoice_id;
    ELSIF total_paid > 0 THEN
        UPDATE public.invoices
           SET status = 'PARTIAL', paid_amount = total_paid
         WHERE id = p_invoice_id;
    ELSE
        UPDATE public.invoices
           SET status = 'PENDING', paid_amount = 0
         WHERE id = p_invoice_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- update_invoice_status() (the trigger handler on payment_allocations) already
-- delegates to update_invoice_status_for_id via CREATE OR REPLACE in
-- 20260204130000 and 20260204140000, so replacing the helper above is enough.
-- We re-create it here for safety in case of partial migration history.
CREATE OR REPLACE FUNCTION update_invoice_status()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        PERFORM update_invoice_status_for_id(OLD.invoice_id);
        RETURN OLD;
    END IF;

    PERFORM update_invoice_status_for_id(NEW.invoice_id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
