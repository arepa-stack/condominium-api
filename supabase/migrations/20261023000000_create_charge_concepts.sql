-- Charge concepts: what an invoice charges for (e.g. "Condominio", "Cisterna",
-- "Reparaciones y Pintura"). Invoices reference a concept by id so the admin
-- can group them without parsing the free-text description.
--
--  kind = ORDINARY       recurring charge, grouped by concept + period
--  kind = EXTRAORDINARY  one-off work with a goal (base_amount), grouped by concept
--
--  base_amount: total to split for ALIQUOT/EQUAL, per-unit amount for FIXED.
--               Required for EXTRAORDINARY (the goal); optional otherwise.

CREATE TABLE IF NOT EXISTS public.charge_concepts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
    kind VARCHAR(20) NOT NULL CHECK (kind IN ('ORDINARY', 'EXTRAORDINARY')),
    base_amount NUMERIC(12, 2) CHECK (base_amount IS NULL OR base_amount > 0),
    distribution VARCHAR(20) NOT NULL DEFAULT 'ALIQUOT' CHECK (distribution IN ('ALIQUOT', 'EQUAL', 'FIXED')),
    decision_id UUID REFERENCES public.decisions(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT charge_concepts_extraordinary_goal CHECK (kind <> 'EXTRAORDINARY' OR base_amount IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_charge_concepts_building_name
    ON public.charge_concepts(building_id, lower(btrim(name)));

-- Nullable on purpose: existing invoices are classified by a one-time script.
-- NO ACTION (checked at statement end) blocks deleting a concept that still has
-- invoices, but lets a building delete cascade to both its invoices and concepts.
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS concept_id UUID REFERENCES public.charge_concepts(id) ON DELETE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_invoices_concept_period ON public.invoices(concept_id, period);

ALTER TABLE public.charge_concepts ENABLE ROW LEVEL SECURITY;

-- Writes go through the service_role client (bypasses RLS). Reads: admins and
-- board members of the building.
CREATE POLICY "Admins can view all charge concepts"
    ON public.charge_concepts
    FOR SELECT USING (public.get_my_role() = 'admin');

CREATE POLICY "Board can view charge concepts for their buildings"
    ON public.charge_concepts
    FOR SELECT USING (
        building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );
