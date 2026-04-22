-- decisions module — base tables
-- Spec: docs/encuentas.md §4

BEGIN;

-- =================================================================
-- decisions: one row per "case" (e.g., "Reparación del portón")
-- =================================================================
CREATE TABLE IF NOT EXISTS public.decisions (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    building_id              uuid NOT NULL REFERENCES public.buildings(id) ON DELETE RESTRICT,
    created_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    title                    text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
    description              text,
    photo_url                text,
    status                   text NOT NULL DEFAULT 'RECEPTION'
                               CHECK (status IN ('RECEPTION','VOTING','TIEBREAK_PENDING','RESOLVED','CANCELLED')),
    current_round            smallint NOT NULL DEFAULT 1 CHECK (current_round >= 1),
    reception_deadline       timestamptz NOT NULL,
    voting_deadline          timestamptz NOT NULL,
    tiebreak_duration_hours  integer NOT NULL DEFAULT 48
                               CHECK (tiebreak_duration_hours BETWEEN 1 AND 720),
    winner_quote_id          uuid,                       -- FK added later (circular)
    resulting_type           text CHECK (resulting_type IN ('INVOICE','ASSESSMENT') OR resulting_type IS NULL),
    resulting_id             uuid,
    finalized_at             timestamptz,
    cancelled_at             timestamptz,
    cancel_reason            text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now(),
    CHECK (voting_deadline > reception_deadline),
    CHECK (status <> 'CANCELLED' OR (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
    CHECK (status <> 'RESOLVED' OR (finalized_at IS NOT NULL AND winner_quote_id IS NOT NULL))
);

-- =================================================================
-- decision_quotes: 1 quote per uploader per decision
-- =================================================================
CREATE TABLE IF NOT EXISTS public.decision_quotes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id        uuid NOT NULL REFERENCES public.decisions(id) ON DELETE CASCADE,
    uploader_user_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploader_unit_id   uuid REFERENCES public.units(id) ON DELETE SET NULL,
    provider_name      text NOT NULL CHECK (char_length(provider_name) BETWEEN 2 AND 200),
    amount             numeric(12,2) NOT NULL CHECK (amount > 0),
    notes              text,
    file_url           text NOT NULL,
    deleted_at         timestamptz,
    deleted_by         uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    deletion_reason    text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (deleted_at IS NULL OR deletion_reason IS NOT NULL)
);

-- Now add the circular FK on decisions.winner_quote_id (idempotent)
ALTER TABLE public.decisions
    DROP CONSTRAINT IF EXISTS decisions_winner_quote_id_fkey;
ALTER TABLE public.decisions
    ADD CONSTRAINT decisions_winner_quote_id_fkey
    FOREIGN KEY (winner_quote_id) REFERENCES public.decision_quotes(id) ON DELETE SET NULL;

-- =================================================================
-- decision_votes: 1 vote per (decision, round, apartment)
-- =================================================================
CREATE TABLE IF NOT EXISTS public.decision_votes (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id        uuid NOT NULL REFERENCES public.decisions(id) ON DELETE CASCADE,
    round              smallint NOT NULL CHECK (round >= 1),
    apartment_id       uuid NOT NULL REFERENCES public.units(id) ON DELETE RESTRICT,
    quote_id           uuid NOT NULL REFERENCES public.decision_quotes(id) ON DELETE RESTRICT,
    voted_by_user_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (decision_id, round, apartment_id)
);

-- =================================================================
-- decision_audit_log: append-only event trail
-- =================================================================
CREATE TABLE IF NOT EXISTS public.decision_audit_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    decision_id     uuid NOT NULL REFERENCES public.decisions(id) ON DELETE CASCADE,
    event           text NOT NULL CHECK (event IN (
        'CREATED','DEADLINE_EXTENDED','CANCELLED','QUOTE_DELETED',
        'FINALIZED','TIEBREAK_OPENED','WINNER_SET_MANUAL',
        'CHARGE_GENERATED','PHASE_ADVANCED'
    )),
    actor_user_id   uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    payload         jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- =================================================================
-- Indexes
-- =================================================================
CREATE INDEX IF NOT EXISTS idx_decisions_building_status
    ON public.decisions(building_id, status);

CREATE INDEX IF NOT EXISTS idx_decisions_pending_finalize
    ON public.decisions(status) WHERE status IN ('RECEPTION','VOTING');

CREATE INDEX IF NOT EXISTS idx_decision_quotes_active
    ON public.decision_quotes(decision_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_decision_votes_tally
    ON public.decision_votes(decision_id, round, quote_id);

CREATE INDEX IF NOT EXISTS idx_decision_audit_decision
    ON public.decision_audit_log(decision_id, created_at DESC);

-- =================================================================
-- updated_at triggers (reuse project-wide public.update_updated_at_column())
-- =================================================================
DROP TRIGGER IF EXISTS trg_decisions_updated_at ON public.decisions;
CREATE TRIGGER trg_decisions_updated_at
    BEFORE UPDATE ON public.decisions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_decision_quotes_updated_at ON public.decision_quotes;
CREATE TRIGGER trg_decision_quotes_updated_at
    BEFORE UPDATE ON public.decision_quotes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMIT;
