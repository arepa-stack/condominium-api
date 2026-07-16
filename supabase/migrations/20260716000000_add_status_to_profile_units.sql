-- Per-building membership approval status.
-- profiles.status is account-level; a person may be ACTIVE in building A while
-- PENDING approval in building B. That per-building state lives here.
-- Existing rows default to 'active' so current single-building memberships are
-- unaffected by the backfill.
ALTER TABLE public.profile_units
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'rejected'));

-- Backfill from the account-level status so pre-existing memberships reflect
-- reality: a still-pending profile's membership must be 'pending' (otherwise it
-- could never be approved), a rejected profile's 'rejected'. Everything else
-- (active/inactive) keeps the 'active' default.
UPDATE public.profile_units pu
SET status = 'pending'
FROM public.profiles p
WHERE pu.profile_id = p.id AND p.status = 'pending';

UPDATE public.profile_units pu
SET status = 'rejected'
FROM public.profiles p
WHERE pu.profile_id = p.id AND p.status = 'rejected';

-- Board's pending queue is queried per building via this column.
CREATE INDEX IF NOT EXISTS idx_profile_units_status ON public.profile_units (status);
