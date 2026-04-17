-- Phase 1 of the profiles.role vs building_members.role separation.
--
-- Context: the legacy profiles.role column conflates two concepts:
--   (1) whether a user is a global system admin, and
--   (2) whether they hold a role inside one or more specific buildings.
-- That makes it impossible to model a user who is a resident in
-- building A AND a board member in building B — the column can only
-- hold one value.
--
-- Target model (reached over 4 phases; this is phase 1 of 4):
--   profiles.app_role  → global capability: 'admin' | 'user'
--   building_members   → per-building role (currently only 'board')
--   profile_units      → implies the user is a 'resident' in those buildings
--
-- This migration is additive and idempotent. It does NOT touch the
-- legacy profiles.role column (dropped in phase 4) or rewrite any RLS
-- helper functions (updated in phase 2 when the backend starts reading
-- app_role). Running this migration twice is safe.

BEGIN;

-- 1. Add profiles.app_role with default 'user'. Runtime code in phase 1
--    does not read this column yet; the backend keeps reading profiles.role.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS app_role TEXT NOT NULL DEFAULT 'user';

-- 2. Backfill app_role from the legacy role. Only 'admin' has a
--    system-level meaning; every other legacy value ('board',
--    'resident', or anything a future migration might add) maps to
--    'user'. A user's per-building role lives in building_members
--    separately.
UPDATE public.profiles
SET app_role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END
WHERE app_role IS DISTINCT FROM (CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END);

-- 3. Constrain profiles.app_role. Guarded by pg_constraint lookup so
--    the migration is idempotent — Postgres lacks IF NOT EXISTS on
--    ADD CONSTRAINT.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'profiles_app_role_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_app_role_check
            CHECK (app_role IN ('admin', 'user'));
    END IF;
END$$;

-- 4. Constrain building_members.role. Historically the column was a
--    plain TEXT default 'board' with no CHECK — anything could have
--    been inserted. Today the backend only writes 'board'; locking
--    that in prevents typos or a future 'admin-assistant'/etc. drift
--    without an explicit schema change.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'building_members_role_check'
    ) THEN
        ALTER TABLE public.building_members
            ADD CONSTRAINT building_members_role_check
            CHECK (role IN ('board'));
    END IF;
END$$;

-- 5. Index on app_role for role-based filtering. get_my_role() still
--    returns profiles.role today; this index becomes useful once the
--    backend migrates reads to app_role in phase 2.
CREATE INDEX IF NOT EXISTS idx_profiles_app_role ON public.profiles(app_role);

COMMIT;
