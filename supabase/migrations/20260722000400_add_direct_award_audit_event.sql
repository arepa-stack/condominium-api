BEGIN;

ALTER TABLE public.decision_audit_log
    DROP CONSTRAINT IF EXISTS decision_audit_log_event_check;

ALTER TABLE public.decision_audit_log
    ADD CONSTRAINT decision_audit_log_event_check CHECK (event IN (
        'CREATED','DEADLINE_EXTENDED','CANCELLED','QUOTE_DELETED',
        'FINALIZED','TIEBREAK_OPENED','WINNER_SET_MANUAL','DIRECT_AWARD',
        'CHARGE_GENERATED','PHASE_ADVANCED'
    ));

COMMIT;
