-- Petty Cash redesign — Phase 1 of 3 (schema only, additive).
--
-- Introduces the ledger-based model for petty cash, alongside the
-- existing tables. This migration does NOT drop the legacy
-- `petty_cash_transactions` table or the `current_balance` /
-- `currency` columns on `petty_cash_fund` — phase 2 will flip the
-- backend to read/write against the ledger, phase 3 drops the legacy
-- pieces once nothing consumes them.
--
-- Design principles:
--   1. Balance is derived, never stored — single source of truth in
--      `petty_cash_balance` (SQL view).
--   2. Append-only ledger — every operation is a new entry, reversals
--      are counter-entries. Mirrors `unit_credit_ledger`.
--   3. Atomicity by construction — one operation = one INSERT.
--   4. Assessments are named batches (ascensor, agua, …). Invoices
--      link to the batch they belong to via `invoices.assessment_id`.

BEGIN;

-- ── 1. petty_cash_entries — append-only ledger ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.petty_cash_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id UUID NOT NULL REFERENCES public.petty_cash_fund(id) ON DELETE CASCADE,

    -- Entry kind. Mirrors unit_credit_ledger's reference_type idea but
    -- broader since petty cash has more moves:
    --   income      — manual replenishment by board.
    --   expense     — building-level spend (amount stored negative).
    --   collection  — auto-entry when a resident pays a petty-cash
    --                 invoice (the fund is replenished automatically).
    --   reversal    — counter-entry for any of the above. Amount is
    --                 the negation of the original entry.
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'collection', 'reversal')),

    -- Signed amount. Conventions:
    --   income / collection → positive (adds to balance).
    --   expense             → negative (subtracts from balance).
    --   reversal            → sign-flipped from the original entry.
    amount DECIMAL(12, 2) NOT NULL CHECK (amount != 0),

    -- Expense-only. Uses the PettyCashCategory enum values defined in
    -- src/core/domain/enums.ts (REPAIR, CLEANING, EMERGENCY, …).
    category VARCHAR(50) NULL,

    description TEXT NOT NULL,
    evidence_url TEXT NULL,

    -- Provenance of the entry. `reference_type` narrows what
    -- `reference_id` points to:
    --   manual            — reference_id is NULL (board clicked a button).
    --   invoice_payment   — reference_id is an invoices.id (a resident
    --                       paid a petty-cash invoice; drives the
    --                       auto-collection loop in phase 2).
    --   reversal          — reference_id is the original
    --                       petty_cash_entries.id being reversed.
    reference_type TEXT NULL CHECK (
        reference_type IN ('manual', 'invoice_payment', 'reversal')
    ),
    reference_id UUID NULL,

    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_fund
    ON public.petty_cash_entries(fund_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_reference
    ON public.petty_cash_entries(reference_type, reference_id)
    WHERE reference_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_petty_cash_entries_created_at
    ON public.petty_cash_entries(created_at);

-- ── 2. petty_cash_balance — derived view ───────────────────────────────────
-- Non-materialized: every SELECT recomputes from the ledger. Keeps
-- the balance consistent with the entries by construction. Same
-- pattern as unit_credit_balance.
CREATE OR REPLACE VIEW public.petty_cash_balance AS
SELECT
    fund_id,
    COALESCE(SUM(amount), 0) AS balance
FROM public.petty_cash_entries
GROUP BY fund_id;

GRANT SELECT ON public.petty_cash_balance TO authenticated;
GRANT SELECT ON public.petty_cash_balance TO service_role;

-- ── 3. petty_cash_assessment — named batches ───────────────────────────────
-- Each assessment run is a labelled batch ("Ascensor abril", "Agua
-- abril"). The admin picks a description + amount; the backend
-- generates one invoice per unit linked to the batch. Transparency
-- can then break the collection progress down per assessment.
CREATE TABLE IF NOT EXISTS public.petty_cash_assessment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fund_id UUID NOT NULL REFERENCES public.petty_cash_fund(id) ON DELETE CASCADE,

    -- Target period. Assessments from the same period with different
    -- descriptions coexist (e.g. ascensor and agua both in 2026-04).
    period TEXT NOT NULL,
    description TEXT NOT NULL,

    -- Optional category tag using the same PettyCashCategory enum as
    -- entries. Powers dashboards that want to group by concept.
    category VARCHAR(50) NULL,

    -- The total amount that was prorated across units for this batch.
    -- Stored here redundantly (also derivable from SUM(invoices.amount))
    -- so dashboards don't have to JOIN to the batch children for the
    -- headline number.
    total_amount DECIMAL(12, 2) NOT NULL CHECK (total_amount > 0),

    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_assessment_fund
    ON public.petty_cash_assessment(fund_id);
CREATE INDEX IF NOT EXISTS idx_petty_cash_assessment_period
    ON public.petty_cash_assessment(period);

-- ── 4. invoices.assessment_id — batch backlink ─────────────────────────────
-- Nullable: only PETTY_CASH invoices with unit_id (the ones generated
-- by a batch) are expected to carry this. Everything else stays NULL.
-- ON DELETE SET NULL — if a batch is deleted (shouldn't happen in
-- practice, but defensive), the invoices stay, just detached.
ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS assessment_id UUID NULL
    REFERENCES public.petty_cash_assessment(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_assessment_id
    ON public.invoices(assessment_id)
    WHERE assessment_id IS NOT NULL;

-- ── 5. RLS policies for the new tables ─────────────────────────────────────
-- Same pattern used by petty_cash_fund / petty_cash_transactions:
-- admins see everything; board members see fund(s) of buildings
-- where they hold a board role; residents see nothing directly
-- (backend access via service_role).

ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_assessment ENABLE ROW LEVEL SECURITY;

-- petty_cash_entries
CREATE POLICY "Board can view entries for their buildings"
    ON public.petty_cash_entries
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.petty_cash_fund f
            WHERE f.id = petty_cash_entries.fund_id
            AND f.building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        )
    );

CREATE POLICY "Admins can view all entries"
    ON public.petty_cash_entries
    FOR SELECT USING (public.get_my_role() = 'admin');

CREATE POLICY "Admins can manage all entries"
    ON public.petty_cash_entries
    FOR ALL USING (public.get_my_role() = 'admin');

CREATE POLICY "Board can manage entries for their buildings"
    ON public.petty_cash_entries
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.petty_cash_fund f
            WHERE f.id = petty_cash_entries.fund_id
            AND f.building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        )
    );

-- petty_cash_assessment
CREATE POLICY "Board can view assessments for their buildings"
    ON public.petty_cash_assessment
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.petty_cash_fund f
            WHERE f.id = petty_cash_assessment.fund_id
            AND f.building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        )
    );

CREATE POLICY "Admins can view all assessments"
    ON public.petty_cash_assessment
    FOR SELECT USING (public.get_my_role() = 'admin');

CREATE POLICY "Admins can manage all assessments"
    ON public.petty_cash_assessment
    FOR ALL USING (public.get_my_role() = 'admin');

CREATE POLICY "Board can manage assessments for their buildings"
    ON public.petty_cash_assessment
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.petty_cash_fund f
            WHERE f.id = petty_cash_assessment.fund_id
            AND f.building_id IN (SELECT building_id FROM public.get_my_board_buildings())
        )
    );

COMMIT;
