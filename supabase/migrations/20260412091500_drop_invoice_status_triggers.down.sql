-- =====================================================================
-- Rollback for 20260412091500_drop_invoice_status_triggers.sql
--
-- Restores the trigger-owned invoice status model with PARTIAL support
-- (the post-20260412090000 state — we do NOT roll back further than
-- that, because the PARTIAL-aware version is always a strict
-- superset of the PAID/PENDING-only version).
--
-- WARNING: after this rollback, the application code still assumes it
-- owns paid_amount/status. Running the app against a DB with these
-- triggers recreated will produce double-writes and is only intended
-- as an emergency rollback while you revert the application code too.
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

CREATE OR REPLACE FUNCTION update_invoices_on_payment_status_change()
RETURNS TRIGGER AS $$
DECLARE
    alloc RECORD;
BEGIN
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        FOR alloc IN SELECT invoice_id FROM public.payment_allocations WHERE payment_id = NEW.id LOOP
            PERFORM update_invoice_status_for_id(alloc.invoice_id);
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_invoice_status ON public.payment_allocations;
CREATE TRIGGER trigger_update_invoice_status
AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
FOR EACH ROW
EXECUTE FUNCTION update_invoice_status();

DROP TRIGGER IF EXISTS trigger_update_invoices_on_payment_status_change ON public.payments;
CREATE TRIGGER trigger_update_invoices_on_payment_status_change
AFTER UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION update_invoices_on_payment_status_change();

COMMIT;
