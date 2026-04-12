-- =====================================================================
-- Rollback for 20260412090000_trigger_emit_partial_status.sql
--
-- Restores the two-state (PAID/PENDING) trigger logic as it was after
-- 20260204140000_simplify_invoice_status.sql.
--
-- WARNING: if any invoices are currently in 'PARTIAL' status when this
-- rollback runs, the next allocation or payment status change will
-- silently flip them to PENDING. Clean up PARTIAL rows first if that
-- would be a problem.
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
    ELSE
        UPDATE public.invoices
           SET status = 'PENDING', paid_amount = total_paid
         WHERE id = p_invoice_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

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
