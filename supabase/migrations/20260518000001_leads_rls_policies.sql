-- Fix: RLS policies for download_requests
-- CREATE POLICY IF NOT EXISTS not supported — use DROP + CREATE

ALTER TABLE public.download_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "download_requests_public_insert" ON public.download_requests;
CREATE POLICY "download_requests_public_insert"
    ON public.download_requests FOR INSERT
    WITH CHECK (true);

DROP POLICY IF EXISTS "download_requests_admin_all" ON public.download_requests;
CREATE POLICY "download_requests_admin_all"
    ON public.download_requests FOR ALL
    USING (get_my_role() = 'admin');
