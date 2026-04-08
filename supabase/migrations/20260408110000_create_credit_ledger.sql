-- Create unit_credit_ledger table and unit_credit_balance view
-- Tracks credit/debit entries per unit for petty cash refunds and adjustments

-- 1. Create unit_credit_ledger table
CREATE TABLE IF NOT EXISTS public.unit_credit_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id UUID NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
    amount DECIMAL(12, 2) NOT NULL CHECK (amount != 0),
    reason TEXT NOT NULL,
    reference_type VARCHAR(50) NOT NULL,
    reference_id UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_credit_ledger_unit_id ON public.unit_credit_ledger(unit_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_reference_id ON public.unit_credit_ledger(reference_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at ON public.unit_credit_ledger(created_at);

-- 3. Create unit_credit_balance view
CREATE OR REPLACE VIEW public.unit_credit_balance AS
SELECT
    unit_id,
    COALESCE(SUM(amount), 0) AS balance
FROM public.unit_credit_ledger
GROUP BY unit_id;

-- 4. Enable RLS
ALTER TABLE public.unit_credit_ledger ENABLE ROW LEVEL SECURITY;
