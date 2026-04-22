-- decisions module — RLS policies
-- Spec: docs/encuentas.md §5

BEGIN;

-- ==== decisions ====
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decisions_select ON public.decisions;
CREATE POLICY decisions_select ON public.decisions FOR SELECT USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
    OR building_id = ANY (public.get_my_building_ids_as_resident())
);

DROP POLICY IF EXISTS decisions_insert ON public.decisions;
CREATE POLICY decisions_insert ON public.decisions FOR INSERT WITH CHECK (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

DROP POLICY IF EXISTS decisions_update ON public.decisions;
CREATE POLICY decisions_update ON public.decisions FOR UPDATE USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

-- No DELETE policy: cancellation is an UPDATE.

-- ==== decision_quotes ====
ALTER TABLE public.decision_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_quotes_select ON public.decision_quotes;
CREATE POLICY decision_quotes_select ON public.decision_quotes FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_quotes.decision_id
        AND (
            public.get_my_role() = 'admin'
            OR d.building_id = ANY (public.get_my_building_ids_as_board())
            OR d.building_id = ANY (public.get_my_building_ids_as_resident())
        )
    )
);

DROP POLICY IF EXISTS decision_quotes_insert ON public.decision_quotes;
CREATE POLICY decision_quotes_insert ON public.decision_quotes FOR INSERT WITH CHECK (
    uploader_user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_quotes.decision_id
        AND d.status = 'RECEPTION'
        AND (
            public.get_my_role() = 'admin'
            OR d.building_id = ANY (public.get_my_building_ids_as_board())
            OR d.building_id = ANY (public.get_my_building_ids_as_resident())
        )
    )
);

DROP POLICY IF EXISTS decision_quotes_update ON public.decision_quotes;
CREATE POLICY decision_quotes_update ON public.decision_quotes FOR UPDATE USING (
    public.get_my_role() = 'admin'
    OR EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_quotes.decision_id
        AND d.building_id = ANY (public.get_my_building_ids_as_board())
    )
    OR (
        uploader_user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.decisions d
            WHERE d.id = decision_quotes.decision_id AND d.status = 'RECEPTION'
        )
    )
);

-- ==== decision_votes ====
ALTER TABLE public.decision_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_votes_select ON public.decision_votes;
CREATE POLICY decision_votes_select ON public.decision_votes FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_votes.decision_id
        AND (
            public.get_my_role() = 'admin'
            OR d.building_id = ANY (public.get_my_building_ids_as_board())
            OR d.building_id = ANY (public.get_my_building_ids_as_resident())
        )
    )
);

DROP POLICY IF EXISTS decision_votes_insert ON public.decision_votes;
CREATE POLICY decision_votes_insert ON public.decision_votes FOR INSERT WITH CHECK (
    voted_by_user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.profile_units pu
        WHERE pu.profile_id = auth.uid() AND pu.unit_id = decision_votes.apartment_id
    )
    AND EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_votes.decision_id
        AND d.status = 'VOTING'
        AND d.voting_deadline > now()
        AND d.current_round = decision_votes.round
    )
);

-- No UPDATE/DELETE policies: votes immutable.

-- ==== decision_audit_log ====
ALTER TABLE public.decision_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_audit_select ON public.decision_audit_log;
CREATE POLICY decision_audit_select ON public.decision_audit_log FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_audit_log.decision_id
        AND (
            public.get_my_role() = 'admin'
            OR d.building_id = ANY (public.get_my_building_ids_as_board())
        )
    )
);

DROP POLICY IF EXISTS decision_audit_insert ON public.decision_audit_log;
CREATE POLICY decision_audit_insert ON public.decision_audit_log FOR INSERT WITH CHECK (
    actor_user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.decisions d
        WHERE d.id = decision_audit_log.decision_id
        AND (
            public.get_my_role() = 'admin'
            OR d.building_id = ANY (public.get_my_building_ids_as_board())
        )
    )
);

COMMIT;
