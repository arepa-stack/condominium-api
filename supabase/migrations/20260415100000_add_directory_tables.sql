-- =====================================================
-- Directorio del Condominio: junta y personal residencial
-- =====================================================

CREATE TABLE IF NOT EXISTS public.board_members (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    apartment_number TEXT,
    photo_url TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    is_current_board BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.residential_workers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    building_id UUID NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT,
    photo_url TEXT,
    work_schedule TEXT,
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_board_members_building_id ON public.board_members(building_id);
CREATE INDEX IF NOT EXISTS idx_board_members_building_active_current ON public.board_members(building_id, is_active, is_current_board);
CREATE INDEX IF NOT EXISTS idx_residential_workers_building_id ON public.residential_workers(building_id);
CREATE INDEX IF NOT EXISTS idx_residential_workers_building_active ON public.residential_workers(building_id, is_active);

-- updated_at triggers
DROP TRIGGER IF EXISTS update_board_members_updated_at ON public.board_members;
CREATE TRIGGER update_board_members_updated_at
    BEFORE UPDATE ON public.board_members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_residential_workers_updated_at ON public.residential_workers;
CREATE TRIGGER update_residential_workers_updated_at
    BEFORE UPDATE ON public.residential_workers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residential_workers ENABLE ROW LEVEL SECURITY;

-- board_members: lectura para admin, junta del edificio y residentes con unidad en el edificio
DROP POLICY IF EXISTS "Directory board_members select" ON public.board_members;
CREATE POLICY "Directory board_members select" ON public.board_members
    FOR SELECT USING (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        OR EXISTS (
            SELECT 1
            FROM public.profile_units pu
            JOIN public.units u ON u.id = pu.unit_id
            WHERE pu.profile_id = auth.uid()
            AND u.building_id = board_members.building_id
        )
    );

DROP POLICY IF EXISTS "Directory board_members insert" ON public.board_members;
CREATE POLICY "Directory board_members insert" ON public.board_members
    FOR INSERT WITH CHECK (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

DROP POLICY IF EXISTS "Directory board_members update" ON public.board_members;
CREATE POLICY "Directory board_members update" ON public.board_members
    FOR UPDATE USING (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

DROP POLICY IF EXISTS "Directory board_members delete" ON public.board_members;
CREATE POLICY "Directory board_members delete" ON public.board_members
    FOR DELETE USING (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

-- residential_workers: mismas reglas de visibilidad por edificio
DROP POLICY IF EXISTS "Directory residential_workers select" ON public.residential_workers;
CREATE POLICY "Directory residential_workers select" ON public.residential_workers
    FOR SELECT USING (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        OR EXISTS (
            SELECT 1
            FROM public.profile_units pu
            JOIN public.units u ON u.id = pu.unit_id
            WHERE pu.profile_id = auth.uid()
            AND u.building_id = residential_workers.building_id
        )
    );

DROP POLICY IF EXISTS "Directory residential_workers insert" ON public.residential_workers;
CREATE POLICY "Directory residential_workers insert" ON public.residential_workers
    FOR INSERT WITH CHECK (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

DROP POLICY IF EXISTS "Directory residential_workers update" ON public.residential_workers;
CREATE POLICY "Directory residential_workers update" ON public.residential_workers
    FOR UPDATE USING (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

DROP POLICY IF EXISTS "Directory residential_workers delete" ON public.residential_workers;
CREATE POLICY "Directory residential_workers delete" ON public.residential_workers
    FOR DELETE USING (
        public.get_my_role() = 'admin'
        OR building_id IN (SELECT building_id FROM public.get_my_board_buildings())
    );

GRANT ALL ON public.board_members TO authenticated;
GRANT ALL ON public.residential_workers TO authenticated;
