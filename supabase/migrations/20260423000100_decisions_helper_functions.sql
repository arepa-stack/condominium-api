-- decisions module — SQL helper functions
-- Used by RLS policies (decision_*_select / _insert).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_building_ids_as_resident()
    RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public AS $$
    SELECT COALESCE(array_agg(DISTINCT u.building_id), ARRAY[]::uuid[])
    FROM public.profile_units pu
    JOIN public.units u ON u.id = pu.unit_id
    WHERE pu.profile_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_building_ids_as_resident() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_building_ids_as_board()
    RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public AS $$
    SELECT COALESCE(array_agg(DISTINCT bm.building_id), ARRAY[]::uuid[])
    FROM public.building_members bm
    WHERE bm.profile_id = auth.uid() AND bm.role = 'board';
$$;

GRANT EXECUTE ON FUNCTION public.get_my_building_ids_as_board() TO authenticated;

COMMIT;
