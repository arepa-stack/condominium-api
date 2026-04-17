-- Phase 2 of the role separation: rewrite get_my_role() to derive from
-- the new model (profiles.app_role + building_members) instead of reading
-- the legacy profiles.role column directly.
--
-- The function's RETURN contract stays the same ('admin' | 'board' |
-- 'resident') so ALL existing RLS policies that call it keep working
-- unchanged. This is the whole point of the phased migration: policies
-- consume a stable interface while the underlying source of truth shifts.
--
-- Mapping:
--   profile.app_role = 'admin'                       → 'admin'
--   any building_members row with role='board'        → 'board'
--   neither of the above                              → 'resident'
--
-- Idempotent: CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text AS $$
DECLARE
    v_app_role text;
    v_legacy_role text;
    v_has_board boolean;
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT app_role, role
      INTO v_app_role, v_legacy_role
      FROM public.profiles
     WHERE id = v_user_id;

    -- Fallback to the legacy column during transition: if a row somehow
    -- missed the Phase 1 backfill, treat legacy 'admin' as admin. Once
    -- Phase 4 drops the legacy column this branch becomes unreachable.
    IF v_app_role IS NULL THEN
        v_app_role := CASE WHEN v_legacy_role = 'admin' THEN 'admin' ELSE 'user' END;
    END IF;

    IF v_app_role = 'admin' THEN
        RETURN 'admin';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.building_members
         WHERE profile_id = v_user_id
           AND role = 'board'
    ) INTO v_has_board;

    IF v_has_board THEN
        RETURN 'board';
    END IF;

    RETURN 'resident';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
