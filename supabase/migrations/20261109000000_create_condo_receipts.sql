-- Monthly condominium receipt ("aviso de cobro"), built from the building's
-- expenses of the month.
--
--  expense_codes     per-building catalog (code + description), e.g. 200001 CONSUMO DE AGUA
--  monthly_expenses  each purchase of the month with its invoice file (support document)
--  condo_receipts    snapshot of the generated receipt of a period. Once it exists
--                    the period is closed: its expenses can no longer change.
--                    `lines` = [{ code, description, amount_bs, percent }]
--                    `units` = [{ unit_id, unit_name, aliquot, control_number, total_bs, total_usd }]
--
-- Each unit's charge is an invoice of the building's "Condominio" charge concept
-- (ALIQUOT) for the period, so payments and billing work as for any invoice.

BEGIN;

CREATE TABLE IF NOT EXISTS public.expense_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL CHECK (length(btrim(code)) > 0),
    description VARCHAR(160) NOT NULL CHECK (length(btrim(description)) > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_expense_codes_building_code UNIQUE (building_id, code)
);

CREATE TABLE IF NOT EXISTS public.monthly_expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    code_id UUID NOT NULL REFERENCES public.expense_codes(id) ON DELETE RESTRICT,
    detail TEXT,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL CHECK (currency IN ('USD', 'VES')),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    invoice_path TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monthly_expenses_building_period
    ON public.monthly_expenses(building_id, period);

CREATE TABLE IF NOT EXISTS public.condo_receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    period VARCHAR(7) NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    concept_id UUID NOT NULL REFERENCES public.charge_concepts(id) ON DELETE RESTRICT,
    reserve_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (reserve_percent >= 0 AND reserve_percent <= 100),
    exchange_rate NUMERIC(18, 8) NOT NULL CHECK (exchange_rate > 0),
    rate_source VARCHAR(20) NOT NULL,
    rate_date DATE NOT NULL,
    total_bs NUMERIC(16, 2) NOT NULL,
    total_usd NUMERIC(14, 2) NOT NULL,
    lines JSONB NOT NULL,
    units JSONB NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT uq_condo_receipts_building_period UNIQUE (building_id, period)
);

-- Writes go through the service_role client (bypasses RLS). Reads: admins and
-- board members of the building.
ALTER TABLE public.expense_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.condo_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view expense codes" ON public.expense_codes
    FOR SELECT USING (public.get_my_role() = 'admin');
CREATE POLICY "Board can view expense codes" ON public.expense_codes
    FOR SELECT USING (building_id IN (SELECT building_id FROM public.get_my_board_buildings()));

CREATE POLICY "Admins can view monthly expenses" ON public.monthly_expenses
    FOR SELECT USING (public.get_my_role() = 'admin');
CREATE POLICY "Board can view monthly expenses" ON public.monthly_expenses
    FOR SELECT USING (building_id IN (SELECT building_id FROM public.get_my_board_buildings()));

CREATE POLICY "Admins can view condo receipts" ON public.condo_receipts
    FOR SELECT USING (public.get_my_role() = 'admin');
CREATE POLICY "Board can view condo receipts" ON public.condo_receipts
    FOR SELECT USING (building_id IN (SELECT building_id FROM public.get_my_board_buildings()));

-- Expense invoices (support documents). Private, served through signed URLs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-invoices', 'expense-invoices', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
