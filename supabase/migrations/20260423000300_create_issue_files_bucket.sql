-- decisions module — storage bucket
-- Spec: docs/encuentas.md §5.3

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('issue-files', 'issue-files', false)
ON CONFLICT (id) DO NOTHING;

-- Read policy: members of the building of the decision
-- Path convention: decisions/{decision_id}/issue/{filename}
--                  decisions/{decision_id}/quotes/{quote_id}/{filename}
-- split_part(name, '/', 2) extracts {decision_id} (1-indexed)
DROP POLICY IF EXISTS issue_files_read ON storage.objects;
CREATE POLICY issue_files_read ON storage.objects FOR SELECT
    TO authenticated
    USING (
    bucket_id = 'issue-files'
    AND EXISTS (
        SELECT 1 FROM public.decisions d
        -- cast uuid→text (not text→uuid) so malformed paths fail silently instead of raising
        WHERE d.id::text = split_part(name, '/', 2)
        AND (
            public.get_my_role() = 'admin'
            OR d.building_id = ANY (public.get_my_building_ids_as_board())
            OR d.building_id = ANY (public.get_my_building_ids_as_resident())
        )
    )
);

-- Write happens via service-role (backend) only; no policy for INSERT/UPDATE/DELETE
-- on the authenticated role. Backend uploads with the service key.

COMMIT;
