BEGIN;

ALTER TABLE public.decision_quotes
    ALTER COLUMN file_url DROP NOT NULL;

COMMIT;
