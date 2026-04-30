-- information center module: billboard, residence rules, and recommended services

BEGIN;

-- =================================================================
-- Storage bucket for private information-center attachments
-- =================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('information-center-files', 'information-center-files', false)
ON CONFLICT (id) DO NOTHING;

-- =================================================================
-- Billboard announcements
-- =================================================================
CREATE TABLE IF NOT EXISTS public.billboard_announcements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    author_id       uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    title           varchar(160) NOT NULL CHECK (char_length(trim(title)) >= 3),
    content         text NOT NULL CHECK (char_length(trim(content)) >= 1),
    category        varchar(40) NOT NULL DEFAULT 'INFO'
                    CHECK (category IN ('INFO','URGENT','FINANCIAL','MAINTENANCE','NEWS')),
    attachment_path text,
    is_pinned       boolean NOT NULL DEFAULT false,
    expires_at      timestamptz,
    deleted_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS public.announcement_reads (
    announcement_id uuid NOT NULL REFERENCES public.billboard_announcements(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    read_at         timestamptz NOT NULL DEFAULT now(),
    source          varchar(30) NOT NULL DEFAULT 'detail'
                    CHECK (source IN ('detail','attachment','reaction','manual')),
    PRIMARY KEY (announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.announcement_reactions (
    announcement_id uuid NOT NULL REFERENCES public.billboard_announcements(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    reaction_type   varchar(20) NOT NULL DEFAULT 'UNDERSTOOD'
                    CHECK (reaction_type = 'UNDERSTOOD'),
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (announcement_id, user_id)
);

-- =================================================================
-- Residence rules
-- =================================================================
CREATE TABLE IF NOT EXISTS public.residence_rule_categories (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    name        varchar(80) NOT NULL CHECK (char_length(trim(name)) >= 2),
    description text,
    icon        varchar(50),
    sort_order  integer NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (building_id, name)
);

CREATE TABLE IF NOT EXISTS public.residence_rules (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id     uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    category_id     uuid REFERENCES public.residence_rule_categories(id) ON DELETE SET NULL,
    title           varchar(120) NOT NULL CHECK (char_length(trim(title)) >= 3),
    content         text NOT NULL CHECK (char_length(trim(content)) >= 1),
    attachment_path text,
    is_published    boolean NOT NULL DEFAULT false,
    sort_order      integer NOT NULL DEFAULT 0,
    deleted_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =================================================================
-- Recommended services
-- =================================================================
CREATE TABLE IF NOT EXISTS public.recommended_services (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id    uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
    name           varchar(120) NOT NULL CHECK (char_length(trim(name)) >= 2),
    category       varchar(80) NOT NULL CHECK (char_length(trim(category)) >= 2),
    description    text,
    phone          varchar(40),
    email          varchar(150),
    availability   varchar(150),
    rating         numeric(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
    is_recommended boolean NOT NULL DEFAULT true,
    is_active      boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- =================================================================
-- Indexes
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_billboard_announcements_active
    ON public.billboard_announcements(building_id, is_pinned DESC, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_billboard_announcements_category
    ON public.billboard_announcements(building_id, category)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement
    ON public.announcement_reads(announcement_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_announcement_reactions_announcement
    ON public.announcement_reactions(announcement_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_residence_rule_categories_building
    ON public.residence_rule_categories(building_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_residence_rules_building
    ON public.residence_rules(building_id, is_published, sort_order)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_recommended_services_building
    ON public.recommended_services(building_id, is_active, category, name);

-- =================================================================
-- updated_at triggers
-- =================================================================
DROP TRIGGER IF EXISTS trg_billboard_announcements_updated_at ON public.billboard_announcements;
CREATE TRIGGER trg_billboard_announcements_updated_at
    BEFORE UPDATE ON public.billboard_announcements
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_residence_rule_categories_updated_at ON public.residence_rule_categories;
CREATE TRIGGER trg_residence_rule_categories_updated_at
    BEFORE UPDATE ON public.residence_rule_categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_residence_rules_updated_at ON public.residence_rules;
CREATE TRIGGER trg_residence_rules_updated_at
    BEFORE UPDATE ON public.residence_rules
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_recommended_services_updated_at ON public.recommended_services;
CREATE TRIGGER trg_recommended_services_updated_at
    BEFORE UPDATE ON public.recommended_services
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =================================================================
-- Row level security
-- =================================================================
ALTER TABLE public.billboard_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residence_rule_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residence_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommended_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billboard_announcements_select ON public.billboard_announcements;
CREATE POLICY billboard_announcements_select ON public.billboard_announcements FOR SELECT USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
    OR building_id = ANY (public.get_my_building_ids_as_resident())
);

DROP POLICY IF EXISTS billboard_announcements_insert ON public.billboard_announcements;
CREATE POLICY billboard_announcements_insert ON public.billboard_announcements FOR INSERT WITH CHECK (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

DROP POLICY IF EXISTS billboard_announcements_update ON public.billboard_announcements;
CREATE POLICY billboard_announcements_update ON public.billboard_announcements FOR UPDATE
USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
)
WITH CHECK (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

DROP POLICY IF EXISTS announcement_reads_select ON public.announcement_reads;
CREATE POLICY announcement_reads_select ON public.announcement_reads FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.billboard_announcements a
        WHERE a.id = announcement_reads.announcement_id
        AND (
            public.get_my_role() = 'admin'
            OR a.building_id = ANY (public.get_my_building_ids_as_board())
        )
    )
);

DROP POLICY IF EXISTS announcement_reads_insert ON public.announcement_reads;
CREATE POLICY announcement_reads_insert ON public.announcement_reads FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.billboard_announcements a
        WHERE a.id = announcement_reads.announcement_id
        AND a.deleted_at IS NULL
        AND (
            public.get_my_role() = 'admin'
            OR a.building_id = ANY (public.get_my_building_ids_as_board())
            OR a.building_id = ANY (public.get_my_building_ids_as_resident())
        )
    )
);

DROP POLICY IF EXISTS announcement_reactions_select ON public.announcement_reactions;
CREATE POLICY announcement_reactions_select ON public.announcement_reactions FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
        SELECT 1 FROM public.billboard_announcements a
        WHERE a.id = announcement_reactions.announcement_id
        AND (
            public.get_my_role() = 'admin'
            OR a.building_id = ANY (public.get_my_building_ids_as_board())
        )
    )
);

DROP POLICY IF EXISTS announcement_reactions_insert ON public.announcement_reactions;
CREATE POLICY announcement_reactions_insert ON public.announcement_reactions FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.billboard_announcements a
        WHERE a.id = announcement_reactions.announcement_id
        AND a.deleted_at IS NULL
        AND (
            public.get_my_role() = 'admin'
            OR a.building_id = ANY (public.get_my_building_ids_as_board())
            OR a.building_id = ANY (public.get_my_building_ids_as_resident())
        )
    )
);

DROP POLICY IF EXISTS announcement_reactions_delete ON public.announcement_reactions;
CREATE POLICY announcement_reactions_delete ON public.announcement_reactions FOR DELETE USING (
    user_id = auth.uid()
);

DROP POLICY IF EXISTS residence_rule_categories_select ON public.residence_rule_categories;
CREATE POLICY residence_rule_categories_select ON public.residence_rule_categories FOR SELECT USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
    OR building_id = ANY (public.get_my_building_ids_as_resident())
);

DROP POLICY IF EXISTS residence_rule_categories_write ON public.residence_rule_categories;
CREATE POLICY residence_rule_categories_write ON public.residence_rule_categories FOR ALL
USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
)
WITH CHECK (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

DROP POLICY IF EXISTS residence_rules_select ON public.residence_rules;
CREATE POLICY residence_rules_select ON public.residence_rules FOR SELECT USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
    OR building_id = ANY (public.get_my_building_ids_as_resident())
);

DROP POLICY IF EXISTS residence_rules_write ON public.residence_rules;
CREATE POLICY residence_rules_write ON public.residence_rules FOR ALL
USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
)
WITH CHECK (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

DROP POLICY IF EXISTS recommended_services_select ON public.recommended_services;
CREATE POLICY recommended_services_select ON public.recommended_services FOR SELECT USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
    OR building_id = ANY (public.get_my_building_ids_as_resident())
);

DROP POLICY IF EXISTS recommended_services_write ON public.recommended_services;
CREATE POLICY recommended_services_write ON public.recommended_services FOR ALL
USING (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
)
WITH CHECK (
    public.get_my_role() = 'admin'
    OR building_id = ANY (public.get_my_building_ids_as_board())
);

DROP POLICY IF EXISTS information_center_files_read ON storage.objects;
CREATE POLICY information_center_files_read ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'information-center-files'
        AND (
            public.get_my_role() = 'admin'
            OR split_part(name, '/', 2) = ANY (
                ARRAY(SELECT unnest(public.get_my_building_ids_as_board())::text)
            )
            OR split_part(name, '/', 2) = ANY (
                ARRAY(SELECT unnest(public.get_my_building_ids_as_resident())::text)
            )
        )
    );

COMMIT;
