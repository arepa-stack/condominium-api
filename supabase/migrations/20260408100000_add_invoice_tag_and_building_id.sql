-- Add tag column, building_id, and make unit_id nullable on invoices
-- This supports PETTY_CASH invoices that belong to a building, not a unit

-- 1. Add tag column with default NORMAL
ALTER TABLE public.invoices
ADD COLUMN tag VARCHAR(20) NOT NULL DEFAULT 'NORMAL';

ALTER TABLE public.invoices
ADD CONSTRAINT invoices_tag_check CHECK (tag IN ('NORMAL', 'PETTY_CASH'));

-- 2. Add building_id (nullable — only required for PETTY_CASH invoices)
ALTER TABLE public.invoices
ADD COLUMN building_id UUID REFERENCES public.buildings(id) ON DELETE CASCADE;

-- 3. Make unit_id nullable (PETTY_CASH invoices belong to a building, not a unit)
ALTER TABLE public.invoices
ALTER COLUMN unit_id DROP NOT NULL;

-- 4. Add CHECK constraint: at least one of unit_id or building_id must be set
ALTER TABLE public.invoices
ADD CONSTRAINT invoices_unit_or_building_required CHECK (
    unit_id IS NOT NULL OR building_id IS NOT NULL
);

-- 5. Backfill existing rows (safety — DEFAULT already handles new rows)
UPDATE public.invoices
SET tag = 'NORMAL'
WHERE tag IS NULL;

-- 6. Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_tag ON public.invoices(tag);
CREATE INDEX IF NOT EXISTS idx_invoices_building_id ON public.invoices(building_id);
