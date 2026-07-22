BEGIN;

ALTER TABLE public.decisions
    ADD COLUMN IF NOT EXISTS process_type text NOT NULL DEFAULT 'VOTING';

ALTER TABLE public.decisions
    DROP CONSTRAINT IF EXISTS decisions_process_type_check;

ALTER TABLE public.decisions
    ADD CONSTRAINT decisions_process_type_check
    CHECK (process_type IN ('VOTING', 'DIRECT_AWARD'));

COMMIT;
