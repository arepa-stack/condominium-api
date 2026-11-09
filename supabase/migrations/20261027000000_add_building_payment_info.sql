-- Per-building payment details shown to residents on "Pagar ahora":
-- bank account, Pago Móvil and an optional QR image (private bucket, served via signed URL).
-- Shape: { bank_name, bank_code, account_holder, rif, account_number, pago_movil_phone, email, qr_path }.

BEGIN;

ALTER TABLE public.buildings
    ADD COLUMN IF NOT EXISTS payment_info JSONB;

INSERT INTO storage.buckets (id, name, public)
VALUES ('building-payment-files', 'building-payment-files', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
