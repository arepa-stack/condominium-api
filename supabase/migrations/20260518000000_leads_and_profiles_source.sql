-- ============================================================
-- Migration: Leads module + profiles source tracking
-- Date: 2026-05-18
-- ============================================================
-- 1. Add source + document_id to profiles
-- 2. Create download_requests table (leads from the web landing page)
-- 3. Drop registration_requests (replaced by pending users flow)
-- ============================================================

-- ─── 1. profiles: source + document_id ───────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin'
    CHECK (source IN ('qr', 'invitation', 'admin')),
  ADD COLUMN IF NOT EXISTS document_id text;

-- ─── 2. download_requests (landing page leads) ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.download_requests (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name        TEXT        NOT NULL,
    contact          TEXT        NOT NULL,
    email            TEXT,
    building_name    TEXT        NOT NULL,
    location         TEXT,
    estimated_users  TEXT,
    status           TEXT        NOT NULL DEFAULT 'new'
                                   CHECK (status IN ('new', 'viewed', 'contacted', 'archived')),
    viewed_at        TIMESTAMPTZ,
    contacted_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add status columns if table already existed without them
ALTER TABLE public.download_requests
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'viewed', 'contacted', 'archived')),
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contacted_at TIMESTAMPTZ;

-- RLS for download_requests
ALTER TABLE public.download_requests ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT (landing page form is public)
DROP POLICY IF EXISTS "download_requests_public_insert" ON public.download_requests;
CREATE POLICY "download_requests_public_insert"
    ON public.download_requests FOR INSERT
    WITH CHECK (true);

-- Admin can read/update all leads
DROP POLICY IF EXISTS "download_requests_admin_all" ON public.download_requests;
CREATE POLICY "download_requests_admin_all"
    ON public.download_requests FOR ALL
    USING (get_my_role() = 'admin');

-- ─── 3. Drop registration_requests (no longer used) ─────────────────────────

DROP TABLE IF EXISTS public.registration_requests CASCADE;
