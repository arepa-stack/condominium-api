-- Registration flow tables:
--   registration_requests : stores resident join requests (via QR scan or unit invitation)
--   unit_invitations      : stores invitations sent by existing residents to new unit members

-- ─────────────────────────────────────────────────────────────────────────────
-- registration_requests
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE registration_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id             UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    unit_id                 UUID NOT NULL REFERENCES units(id)     ON DELETE CASCADE,
    email                   TEXT NOT NULL,
    first_name              TEXT NOT NULL,
    last_name               TEXT NOT NULL,
    document_id             TEXT NOT NULL,
    phone                   TEXT,
    source                  TEXT NOT NULL CHECK (source IN ('qr', 'invitation')),
    invited_by_profile_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
    invitation_id           UUID,  -- FK added below after unit_invitations is created
    status                  TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'rejected')),
    created_profile_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_by_profile_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
    reviewed_at             TIMESTAMPTZ,
    rejection_reason        TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent duplicate pending requests for the same email+building
CREATE UNIQUE INDEX registration_requests_pending_email_uq
    ON registration_requests (building_id, email)
    WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- unit_invitations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE unit_invitations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id             UUID NOT NULL REFERENCES units(id)     ON DELETE CASCADE,
    building_id         UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
    inviter_profile_id  UUID NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
    invitee_email       TEXT NOT NULL,
    invitee_name        TEXT,
    token               TEXT UNIQUE NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'claimed', 'expired', 'cancelled')),
    expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
    claimed_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK from registration_requests to unit_invitations (now that the table exists)
ALTER TABLE registration_requests
    ADD CONSTRAINT registration_requests_invitation_id_fkey
    FOREIGN KEY (invitation_id) REFERENCES unit_invitations(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE registration_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_invitations      ENABLE ROW LEVEL SECURITY;

-- registration_requests: anyone can INSERT (public registration form)
CREATE POLICY "registration_requests_public_insert"
    ON registration_requests FOR INSERT
    WITH CHECK (true);

-- registration_requests: admin can see and update all
CREATE POLICY "registration_requests_admin_all"
    ON registration_requests FOR ALL
    USING (get_my_role() = 'admin');

-- registration_requests: board member can see/update requests for their buildings
CREATE POLICY "registration_requests_board_select"
    ON registration_requests FOR SELECT
    USING (
        get_my_role() = 'board' AND
        building_id IN (
            SELECT bm.building_id
            FROM building_members bm
            WHERE bm.profile_id = auth.uid() AND bm.role = 'board'
        )
    );

CREATE POLICY "registration_requests_board_update"
    ON registration_requests FOR UPDATE
    USING (
        get_my_role() = 'board' AND
        building_id IN (
            SELECT bm.building_id
            FROM building_members bm
            WHERE bm.profile_id = auth.uid() AND bm.role = 'board'
        )
    );

-- unit_invitations: inviter (resident) can INSERT and see their own
CREATE POLICY "unit_invitations_inviter_insert"
    ON unit_invitations FOR INSERT
    WITH CHECK (inviter_profile_id = auth.uid());

CREATE POLICY "unit_invitations_inviter_select"
    ON unit_invitations FOR SELECT
    USING (inviter_profile_id = auth.uid());

CREATE POLICY "unit_invitations_inviter_update"
    ON unit_invitations FOR UPDATE
    USING (inviter_profile_id = auth.uid());

-- unit_invitations: board can see all for their buildings
CREATE POLICY "unit_invitations_board_select"
    ON unit_invitations FOR SELECT
    USING (
        get_my_role() = 'board' AND
        building_id IN (
            SELECT bm.building_id
            FROM building_members bm
            WHERE bm.profile_id = auth.uid() AND bm.role = 'board'
        )
    );

-- unit_invitations: admin can see/update all
CREATE POLICY "unit_invitations_admin_all"
    ON unit_invitations FOR ALL
    USING (get_my_role() = 'admin');
