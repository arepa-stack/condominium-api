-- Phase 4 (final) of the role separation.
-- Drops the legacy profiles.role column for good. Prerequisites:
--   * Phase 1 added profiles.app_role + CHECK + backfill.
--   * Phase 2 made the backend read app_role + building_members and
--     rewrote get_my_role() to derive admin|board|resident from them.
--   * Phase 3 removed dual-source scoping in use cases.
--
-- Before dropping the column we need to migrate three RLS policies that
-- still read profiles.role directly (they were authored before
-- get_my_role() existed as a helper). They move to the helper so the
-- post-drop behavior stays identical.

BEGIN;

-- ── 1. Migrate lingering RLS policies to get_my_role() ───────────────────────

DROP POLICY IF EXISTS "Admins and Board can view all unit associations" ON public.profile_units;
CREATE POLICY "Admins and Board can view all unit associations" ON public.profile_units
    FOR SELECT USING (public.get_my_role() IN ('admin', 'board'));

DROP POLICY IF EXISTS "Admins can manage unit associations" ON public.profile_units;
CREATE POLICY "Admins can manage unit associations" ON public.profile_units
    FOR ALL USING (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS "Admins can manage payment allocations" ON public.payment_allocations;
CREATE POLICY "Admins can manage payment allocations" ON public.payment_allocations
    FOR ALL USING (public.get_my_role() IN ('admin', 'board'));

-- ── 2. Simplify get_my_role() — remove the legacy fallback ──────────────────
-- After dropping profiles.role, the CASE WHEN fallback becomes dead code and
-- references a non-existent column. Inline the derivation from app_role +
-- building_members only.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text AS $$
DECLARE
    v_app_role text;
    v_has_board boolean;
    v_user_id uuid := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT app_role INTO v_app_role FROM public.profiles WHERE id = v_user_id;

    IF v_app_role IS NULL THEN
        -- Profile row exists but app_role never set — treat as resident.
        RETURN 'resident';
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

-- ── 3. Drop the legacy profiles.role column + its CHECK constraint ──────────

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

COMMIT;
