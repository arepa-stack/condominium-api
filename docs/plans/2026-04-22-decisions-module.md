# Decisions Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `decisions` module — a competitive quote + voting flow for condominium extraordinary expense decisions, following the spec at `docs/encuentas.md`.

**Architecture:** New isolated module under `src/modules/decisions/` using the project's Clean Architecture layout (domain → application → infrastructure → presentation). Four Postgres tables (`decisions`, `decision_quotes`, `decision_votes`, `decision_audit_log`) protected by RLS. Routes mounted under existing `adminRoutes` (`/api/v1/admin/decisions/...`) and `appRoutes` (`/api/v1/app/decisions/...`). Post-resolution charge generation delegates to existing billing or petty-cash modules via thin adapter ports. Storage in dedicated `issue-files` Supabase bucket.

**Tech Stack:** Bun + ElysiaJS + TypeScript + Supabase (Postgres + Storage). Bun built-in test runner (`bun:test`).

**Convention adjustment from spec:** spec uses `/api/v1/decisions/...`; project convention is `/api/v1/admin/...` + `/api/v1/app/...` (see `src/presentation/admin-routes.ts` + `app-routes.ts`). This plan uses `/api/v1/admin/decisions/...` for Web Admin and `/api/v1/app/decisions/...` for APK to align with existing routing.

---

## Phase Overview

1. **DB schema + RLS** (Tasks 1-4) — migrations and helper SQL
2. **Domain entities** (Tasks 5-9) — pure entities + tally service, all TDD
3. **Repository contracts** (Task 10) — interfaces only
4. **Use cases** (Tasks 11-25) — TDD with in-memory fakes
5. **Charge adapters** (Tasks 26-28) — port + 2 implementations
6. **Supabase repositories** (Tasks 29-32) — real infra
7. **Storage service** (Task 33) — bucket + signed URLs
8. **TypeBox schemas** (Task 34) — shared HTTP DTOs
9. **Admin routes** (Task 35) — Web routes
10. **APK routes** (Task 36) — APK routes
11. **App wiring** (Task 37) — mount in admin/app route groups + Swagger tags
12. **E2E tests** (Tasks 38-42)
13. **Docs** (Tasks 43-44)

---

## Conventions Used

- **Test runner:** `bun test tests/...`
- **Test path mirror:** `src/modules/decisions/X.ts` → `tests/modules/decisions/X.test.ts`
- **Imports:** `@/...` alias for `src/...`
- **Errors:** throw `DomainError` from `@/core/errors` with `code` (UPPER_SNAKE), `message`, `status`
- **Entities:** class with private `props`, validations in constructor, getters, `toJSON()` method
- **Repos:** interface in `domain/repository.ts`, Supabase implementation in `infrastructure/repositories/`
- **Use cases:** class with constructor-injected repos, `execute(...)` method
- **Routes:** Elysia plugin exported from `presentation/routes.ts` (admin) + `app-routes.ts` (APK), each wraps a `createDecisionRoutes(tag)` factory to avoid Swagger duplicate ops
- **Migrations:** `supabase/migrations/YYYYMMDDHHMMSS_name.sql`, idempotent (`IF NOT EXISTS`/`IF EXISTS`) where the existing migrations follow this pattern
- **Commits:** Conventional Commits without `Co-Authored-By` line (per project rule)

---

## Phase 1 — DB Schema + RLS

### Task 1: Create core decisions tables

**Files:**
- Create: `supabase/migrations/20260423000000_create_decisions.sql`

- [ ] **Step 1: Create migration file with table DDL**

```sql
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

-- Now add the circular FK on decisions.winner_quote_id
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
-- updated_at triggers (reuse the project convention if available;
-- otherwise inline)
-- =================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_decisions_updated_at ON public.decisions;
CREATE TRIGGER trg_decisions_updated_at
    BEFORE UPDATE ON public.decisions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_decision_quotes_updated_at ON public.decision_quotes;
CREATE TRIGGER trg_decision_quotes_updated_at
    BEFORE UPDATE ON public.decision_quotes
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
```

- [ ] **Step 2: Apply migration locally**

Run: `bun run db:reset` (recreates DB from scratch, applies all migrations)
Expected: no errors, migration appears in supabase log output.

- [ ] **Step 3: Verify schema**

Run:
```sh
supabase db dump --schema public --data-only=false 2>/dev/null | grep -E "decisions|decision_quotes|decision_votes|decision_audit_log" | head
```
Expected: lines showing the four tables exist.

- [ ] **Step 4: Commit**

```sh
git add supabase/migrations/20260423000000_create_decisions.sql
git commit -m "feat(decisions): add core schema for decisions module"
```

---

### Task 2: Add resident-buildings helper function

**Files:**
- Create: `supabase/migrations/20260423000100_decisions_helper_functions.sql`

- [ ] **Step 1: Create migration**

```sql
-- decisions module — SQL helper functions
-- Used by RLS policies (decision_*_select / _insert).

CREATE OR REPLACE FUNCTION public.get_my_building_ids_as_resident()
    RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT COALESCE(array_agg(DISTINCT u.building_id), ARRAY[]::uuid[])
    FROM public.profile_units pu
    JOIN public.units u ON u.id = pu.unit_id
    WHERE pu.profile_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_building_ids_as_resident() TO authenticated;
```

- [ ] **Step 2: Apply migration**

Run: `bun run db:reset`
Expected: migration applied, function visible.

- [ ] **Step 3: Verify function**

Run:
```sh
supabase db dump --schema public --data-only=false 2>/dev/null | grep get_my_building_ids_as_resident
```
Expected: function definition appears.

- [ ] **Step 4: Commit**

```sh
git add supabase/migrations/20260423000100_decisions_helper_functions.sql
git commit -m "feat(decisions): add get_my_building_ids_as_resident helper"
```

---

### Task 3: Add RLS policies for decisions tables

**Files:**
- Create: `supabase/migrations/20260423000200_decisions_rls.sql`

- [ ] **Step 1: Create migration**

```sql
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
```

- [ ] **Step 2: Apply migration**

Run: `bun run db:reset`
Expected: success, no errors about missing helpers.

- [ ] **Step 3: Smoke test RLS as anon (should fail)**

Run a quick psql probe:
```sh
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '"')" \
  -c "SET ROLE anon; SELECT count(*) FROM public.decisions;"
```
Expected: returns 0 rows or permission error (depending on Postgres version).

- [ ] **Step 4: Commit**

```sh
git add supabase/migrations/20260423000200_decisions_rls.sql
git commit -m "feat(decisions): add RLS policies for decisions tables"
```

---

### Task 4: Create issue-files storage bucket

**Files:**
- Create: `supabase/migrations/20260423000300_create_issue_files_bucket.sql`

- [ ] **Step 1: Create migration**

```sql
-- decisions module — storage bucket
-- Spec: docs/encuentas.md §5.3

INSERT INTO storage.buckets (id, name, public)
VALUES ('issue-files', 'issue-files', false)
ON CONFLICT (id) DO NOTHING;

-- Read policy: members of the building of the decision
DROP POLICY IF EXISTS issue_files_read ON storage.objects;
CREATE POLICY issue_files_read ON storage.objects FOR SELECT USING (
    bucket_id = 'issue-files'
    AND EXISTS (
        SELECT 1 FROM public.decisions d
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
```

- [ ] **Step 2: Apply migration**

Run: `bun run db:reset`
Expected: bucket appears in storage.buckets, policy exists on storage.objects.

- [ ] **Step 3: Verify bucket**

Run: `supabase storage list 2>&1 | grep issue-files`
Expected: bucket `issue-files` listed.

- [ ] **Step 4: Commit**

```sh
git add supabase/migrations/20260423000300_create_issue_files_bucket.sql
git commit -m "feat(decisions): add issue-files storage bucket and RLS"
```

---

(Phase 1 complete. Phase 2 below.)

---

## Phase 2 — Domain entities (TDD)

### Task 5: Decision entity

**Files:**
- Create: `src/modules/decisions/domain/entities/Decision.ts`
- Test: `tests/modules/decisions/domain/Decision.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/modules/decisions/domain/Decision.test.ts
import { describe, it, expect } from 'bun:test';
import { Decision, DecisionStatus, DecisionProps } from '@/modules/decisions/domain/entities/Decision';

const baseProps = (overrides: Partial<DecisionProps> = {}): DecisionProps => ({
    id: 'd1',
    building_id: 'b1',
    created_by: 'u1',
    title: 'Reparación portón',
    reception_deadline: new Date(Date.now() + 60_000),
    voting_deadline: new Date(Date.now() + 120_000),
    ...overrides,
});

describe('Decision Entity', () => {
    it('creates with defaults (status=RECEPTION, current_round=1, tiebreak=48)', () => {
        const d = new Decision(baseProps());
        expect(d.status).toBe(DecisionStatus.RECEPTION);
        expect(d.current_round).toBe(1);
        expect(d.tiebreak_duration_hours).toBe(48);
        expect(d.created_at).toBeInstanceOf(Date);
    });

    it('rejects voting_deadline <= reception_deadline', () => {
        expect(() =>
            new Decision(baseProps({
                voting_deadline: new Date(Date.now() + 30_000),
            }))
        ).toThrow();
    });

    it('rejects title shorter than 5 or longer than 200', () => {
        expect(() => new Decision(baseProps({ title: 'abc' }))).toThrow();
        expect(() => new Decision(baseProps({ title: 'a'.repeat(201) }))).toThrow();
    });

    it('rejects tiebreak_duration_hours out of range', () => {
        expect(() => new Decision(baseProps({ tiebreak_duration_hours: 0 }))).toThrow();
        expect(() => new Decision(baseProps({ tiebreak_duration_hours: 721 }))).toThrow();
    });

    it('advanceToVoting() only when RECEPTION and reception_deadline in past', () => {
        const past = new Date(Date.now() - 1000);
        const future = new Date(Date.now() + 60_000);
        const d = new Decision(baseProps({ reception_deadline: past, voting_deadline: future }));
        d.advanceToVoting();
        expect(d.status).toBe(DecisionStatus.VOTING);
    });

    it('advanceToVoting() throws if reception_deadline not yet passed', () => {
        const d = new Decision(baseProps());
        expect(() => d.advanceToVoting()).toThrow();
    });

    it('resolve(quoteId) only allowed in VOTING or TIEBREAK_PENDING', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        d.resolve('quote-1');
        expect(d.status).toBe(DecisionStatus.RESOLVED);
        expect(d.winner_quote_id).toBe('quote-1');
        expect(d.finalized_at).toBeInstanceOf(Date);
    });

    it('openTiebreak(tiedQuoteIds) increments round and extends voting_deadline', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() - 100),
        }));
        d.advanceToVoting();
        const before = d.voting_deadline.getTime();
        d.openTiebreak();
        expect(d.current_round).toBe(2);
        expect(d.voting_deadline.getTime()).toBeGreaterThan(before);
        expect(d.status).toBe(DecisionStatus.VOTING);
    });

    it('cancel(reason) sets CANCELLED + cancel_reason', () => {
        const d = new Decision(baseProps());
        d.cancel('No funds available');
        expect(d.status).toBe(DecisionStatus.CANCELLED);
        expect(d.cancel_reason).toBe('No funds available');
        expect(d.cancelled_at).toBeInstanceOf(Date);
    });

    it('cancel() throws if already RESOLVED or CANCELLED', () => {
        const d = new Decision(baseProps());
        d.cancel('first');
        expect(() => d.cancel('second')).toThrow();
    });

    it('extendDeadlines() updates fields and validates ordering', () => {
        const d = new Decision(baseProps());
        const newReception = new Date(Date.now() + 600_000);
        const newVoting = new Date(Date.now() + 1_200_000);
        d.extendDeadlines({ reception_deadline: newReception, voting_deadline: newVoting });
        expect(d.reception_deadline.getTime()).toBe(newReception.getTime());
        expect(d.voting_deadline.getTime()).toBe(newVoting.getTime());
    });

    it('extendDeadlines() refuses voting < reception', () => {
        const d = new Decision(baseProps());
        expect(() =>
            d.extendDeadlines({
                reception_deadline: new Date(Date.now() + 600_000),
                voting_deadline: new Date(Date.now() + 300_000),
            })
        ).toThrow();
    });

    it('attachCharge(type, id) sets resulting_type/resulting_id once; second call throws', () => {
        const past = new Date(Date.now() - 1000);
        const d = new Decision(baseProps({
            reception_deadline: past,
            voting_deadline: new Date(Date.now() + 60_000),
        }));
        d.advanceToVoting();
        d.resolve('q1');
        d.attachCharge('INVOICE', 'inv-1');
        expect(d.resulting_type).toBe('INVOICE');
        expect(d.resulting_id).toBe('inv-1');
        expect(() => d.attachCharge('ASSESSMENT', 'a1')).toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `bun test tests/modules/decisions/domain/Decision.test.ts`
Expected: cannot find module `Decision`.

- [ ] **Step 3: Implement Decision entity**

```ts
// src/modules/decisions/domain/entities/Decision.ts
import { DomainError } from '@/core/errors';

export enum DecisionStatus {
    RECEPTION = 'RECEPTION',
    VOTING = 'VOTING',
    TIEBREAK_PENDING = 'TIEBREAK_PENDING',
    RESOLVED = 'RESOLVED',
    CANCELLED = 'CANCELLED',
}

export type DecisionResultingType = 'INVOICE' | 'ASSESSMENT';

export interface DecisionProps {
    id: string;
    building_id: string;
    created_by: string | null;
    title: string;
    description?: string | null;
    photo_url?: string | null;
    status?: DecisionStatus;
    current_round?: number;
    reception_deadline: Date;
    voting_deadline: Date;
    tiebreak_duration_hours?: number;
    winner_quote_id?: string | null;
    resulting_type?: DecisionResultingType | null;
    resulting_id?: string | null;
    finalized_at?: Date | null;
    cancelled_at?: Date | null;
    cancel_reason?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

export class Decision {
    constructor(private props: DecisionProps) {
        if (!props.building_id) throw new DomainError('building_id required', 'VALIDATION_ERROR', 400);
        if (!props.title || props.title.length < 5 || props.title.length > 200) {
            throw new DomainError('title must be 5..200 chars', 'VALIDATION_ERROR', 400);
        }
        if (props.voting_deadline.getTime() <= props.reception_deadline.getTime()) {
            throw new DomainError('voting_deadline must be after reception_deadline',
                'DECISION_INVALID_DEADLINES', 400);
        }
        if (props.tiebreak_duration_hours !== undefined &&
            (props.tiebreak_duration_hours < 1 || props.tiebreak_duration_hours > 720)) {
            throw new DomainError('tiebreak_duration_hours must be between 1 and 720',
                'VALIDATION_ERROR', 400);
        }
        this.props.status ??= DecisionStatus.RECEPTION;
        this.props.current_round ??= 1;
        this.props.tiebreak_duration_hours ??= 48;
        this.props.created_at ??= new Date();
        this.props.updated_at ??= new Date();
    }

    get id() { return this.props.id; }
    get building_id() { return this.props.building_id; }
    get created_by() { return this.props.created_by; }
    get title() { return this.props.title; }
    get description() { return this.props.description ?? null; }
    get photo_url() { return this.props.photo_url ?? null; }
    get status() { return this.props.status!; }
    get current_round() { return this.props.current_round!; }
    get reception_deadline() { return this.props.reception_deadline; }
    get voting_deadline() { return this.props.voting_deadline; }
    get tiebreak_duration_hours() { return this.props.tiebreak_duration_hours!; }
    get winner_quote_id() { return this.props.winner_quote_id ?? null; }
    get resulting_type() { return this.props.resulting_type ?? null; }
    get resulting_id() { return this.props.resulting_id ?? null; }
    get finalized_at() { return this.props.finalized_at ?? null; }
    get cancelled_at() { return this.props.cancelled_at ?? null; }
    get cancel_reason() { return this.props.cancel_reason ?? null; }
    get created_at() { return this.props.created_at!; }
    get updated_at() { return this.props.updated_at!; }

    advanceToVoting() {
        if (this.status !== DecisionStatus.RECEPTION) {
            throw new DomainError('decision is not in RECEPTION', 'DECISION_WRONG_STATUS', 422);
        }
        if (this.reception_deadline.getTime() > Date.now()) {
            throw new DomainError('reception_deadline not yet passed',
                'DECISION_DEADLINE_NOT_YET_PASSED', 422);
        }
        this.props.status = DecisionStatus.VOTING;
    }

    resolve(winnerQuoteId: string) {
        if (this.status !== DecisionStatus.VOTING && this.status !== DecisionStatus.TIEBREAK_PENDING) {
            throw new DomainError('decision is not in VOTING/TIEBREAK_PENDING',
                'DECISION_WRONG_STATUS', 422);
        }
        this.props.status = DecisionStatus.RESOLVED;
        this.props.winner_quote_id = winnerQuoteId;
        this.props.finalized_at = new Date();
    }

    openTiebreak() {
        if (this.status !== DecisionStatus.VOTING) {
            throw new DomainError('tiebreak only from VOTING', 'DECISION_WRONG_STATUS', 422);
        }
        this.props.current_round = this.current_round + 1;
        const newDeadline = new Date(Date.now() + this.tiebreak_duration_hours * 3_600_000);
        this.props.voting_deadline = newDeadline;
        // status stays VOTING for round 2
    }

    markTiebreakPendingManual() {
        if (this.status !== DecisionStatus.VOTING) {
            throw new DomainError('only from VOTING', 'DECISION_WRONG_STATUS', 422);
        }
        this.props.status = DecisionStatus.TIEBREAK_PENDING;
    }

    cancel(reason: string) {
        if (this.status === DecisionStatus.RESOLVED || this.status === DecisionStatus.CANCELLED) {
            throw new DomainError('cannot cancel terminal decision', 'DECISION_WRONG_STATUS', 422);
        }
        if (!reason?.trim()) {
            throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
        }
        this.props.status = DecisionStatus.CANCELLED;
        this.props.cancelled_at = new Date();
        this.props.cancel_reason = reason;
    }

    extendDeadlines(input: { reception_deadline?: Date; voting_deadline?: Date }) {
        if (this.status !== DecisionStatus.RECEPTION && this.status !== DecisionStatus.VOTING) {
            throw new DomainError('cannot extend in current status', 'DECISION_WRONG_STATUS', 422);
        }
        const reception = input.reception_deadline ?? this.reception_deadline;
        const voting = input.voting_deadline ?? this.voting_deadline;
        if (this.status === DecisionStatus.VOTING && input.reception_deadline) {
            throw new DomainError('cannot extend reception_deadline in VOTING phase',
                'DECISION_WRONG_STATUS', 422);
        }
        if (voting.getTime() <= reception.getTime()) {
            throw new DomainError('voting_deadline must be after reception_deadline',
                'DECISION_INVALID_DEADLINES', 400);
        }
        if (reception.getTime() < Date.now()) {
            throw new DomainError('deadline cannot be in the past', 'DECISION_INVALID_DEADLINES', 400);
        }
        this.props.reception_deadline = reception;
        this.props.voting_deadline = voting;
    }

    attachCharge(type: DecisionResultingType, id: string) {
        if (this.status !== DecisionStatus.RESOLVED) {
            throw new DomainError('charge requires RESOLVED', 'DECISION_WRONG_STATUS', 422);
        }
        if (this.props.resulting_id) {
            throw new DomainError('decision already charged', 'DECISION_ALREADY_CHARGED', 409);
        }
        this.props.resulting_type = type;
        this.props.resulting_id = id;
    }

    toJSON() {
        return {
            id: this.id, building_id: this.building_id, created_by: this.created_by,
            title: this.title, description: this.description, photo_url: this.photo_url,
            status: this.status, current_round: this.current_round,
            reception_deadline: this.reception_deadline,
            voting_deadline: this.voting_deadline,
            tiebreak_duration_hours: this.tiebreak_duration_hours,
            winner_quote_id: this.winner_quote_id,
            resulting_type: this.resulting_type, resulting_id: this.resulting_id,
            finalized_at: this.finalized_at,
            cancelled_at: this.cancelled_at, cancel_reason: this.cancel_reason,
            created_at: this.created_at, updated_at: this.updated_at,
        };
    }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/modules/decisions/domain/Decision.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```sh
git add src/modules/decisions/domain/entities/Decision.ts tests/modules/decisions/domain/Decision.test.ts
git commit -m "feat(decisions): add Decision entity with state transitions"
```

---

(Phase 2 continues with Tasks 6-9: DecisionQuote, DecisionVote, DecisionAuditLog entities and TallyService. Phase 3 onward continues below — see following sections.)

---

> **NOTE TO IMPLEMENTER:** Tasks 6-44 follow the same TDD rhythm (write failing test → implement → run → commit). Due to plan-document size, the following tasks are described in detail per section. Each task is independently committable. If working through this plan with subagent-driven-development, dispatch one subagent per task.

---

### Task 6: DecisionQuote entity

**Files:**
- Create: `src/modules/decisions/domain/entities/DecisionQuote.ts`
- Test: `tests/modules/decisions/domain/DecisionQuote.test.ts`

- [ ] **Step 1: Write tests**

```ts
import { describe, it, expect } from 'bun:test';
import { DecisionQuote, DecisionQuoteProps } from '@/modules/decisions/domain/entities/DecisionQuote';

const base = (o: Partial<DecisionQuoteProps> = {}): DecisionQuoteProps => ({
    id: 'q1', decision_id: 'd1', uploader_user_id: 'u1',
    provider_name: 'Acme S.A.', amount: 1500, file_url: '/path/file.pdf', ...o,
});

describe('DecisionQuote Entity', () => {
    it('creates valid quote', () => {
        const q = new DecisionQuote(base());
        expect(q.deleted_at).toBeNull();
        expect(q.amount).toBe(1500);
    });
    it('rejects amount <= 0', () => {
        expect(() => new DecisionQuote(base({ amount: 0 }))).toThrow();
        expect(() => new DecisionQuote(base({ amount: -1 }))).toThrow();
    });
    it('rejects provider_name too short or too long', () => {
        expect(() => new DecisionQuote(base({ provider_name: 'A' }))).toThrow();
        expect(() => new DecisionQuote(base({ provider_name: 'x'.repeat(201) }))).toThrow();
    });
    it('rejects empty file_url', () => {
        expect(() => new DecisionQuote(base({ file_url: '' }))).toThrow();
    });
    it('softDelete(deleter, reason) sets deleted_at, deleted_by, deletion_reason', () => {
        const q = new DecisionQuote(base());
        q.softDelete('admin-id', 'spam');
        expect(q.deleted_at).toBeInstanceOf(Date);
        expect(q.deleted_by).toBe('admin-id');
        expect(q.deletion_reason).toBe('spam');
    });
    it('softDelete refuses if already deleted', () => {
        const q = new DecisionQuote(base());
        q.softDelete('a', 'r');
        expect(() => q.softDelete('a', 'r2')).toThrow();
    });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `bun test tests/modules/decisions/domain/DecisionQuote.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/modules/decisions/domain/entities/DecisionQuote.ts
import { DomainError } from '@/core/errors';

export interface DecisionQuoteProps {
    id: string;
    decision_id: string;
    uploader_user_id: string | null;
    uploader_unit_id?: string | null;
    provider_name: string;
    amount: number;
    notes?: string | null;
    file_url: string;
    deleted_at?: Date | null;
    deleted_by?: string | null;
    deletion_reason?: string | null;
    created_at?: Date;
    updated_at?: Date;
}

export class DecisionQuote {
    constructor(private props: DecisionQuoteProps) {
        if (!props.decision_id) throw new DomainError('decision_id required', 'VALIDATION_ERROR', 400);
        if (!(props.amount > 0)) throw new DomainError('amount must be > 0', 'QUOTE_INVALID_AMOUNT', 400);
        if (!props.provider_name || props.provider_name.length < 2 || props.provider_name.length > 200) {
            throw new DomainError('provider_name length 2..200', 'VALIDATION_ERROR', 400);
        }
        if (!props.file_url) throw new DomainError('file_url required', 'VALIDATION_ERROR', 400);
        this.props.created_at ??= new Date();
        this.props.updated_at ??= new Date();
    }

    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get uploader_user_id() { return this.props.uploader_user_id; }
    get uploader_unit_id() { return this.props.uploader_unit_id ?? null; }
    get provider_name() { return this.props.provider_name; }
    get amount() { return this.props.amount; }
    get notes() { return this.props.notes ?? null; }
    get file_url() { return this.props.file_url; }
    get deleted_at() { return this.props.deleted_at ?? null; }
    get deleted_by() { return this.props.deleted_by ?? null; }
    get deletion_reason() { return this.props.deletion_reason ?? null; }
    get created_at() { return this.props.created_at!; }
    get updated_at() { return this.props.updated_at!; }
    get isDeleted() { return !!this.props.deleted_at; }

    softDelete(deletedBy: string, reason: string) {
        if (this.isDeleted) throw new DomainError('quote already deleted', 'QUOTE_DELETED', 422);
        if (!reason?.trim()) throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
        this.props.deleted_at = new Date();
        this.props.deleted_by = deletedBy;
        this.props.deletion_reason = reason;
    }

    toJSON() {
        return { ...this.props };
    }
}
```

- [ ] **Step 4: Tests pass**

Run: `bun test tests/modules/decisions/domain/DecisionQuote.test.ts`

- [ ] **Step 5: Commit**

```sh
git add src/modules/decisions/domain/entities/DecisionQuote.ts tests/modules/decisions/domain/DecisionQuote.test.ts
git commit -m "feat(decisions): add DecisionQuote entity"
```

---

### Task 7: DecisionVote entity

**Files:**
- Create: `src/modules/decisions/domain/entities/DecisionVote.ts`
- Test: `tests/modules/decisions/domain/DecisionVote.test.ts`

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'bun:test';
import { DecisionVote, DecisionVoteProps } from '@/modules/decisions/domain/entities/DecisionVote';

const base = (o: Partial<DecisionVoteProps> = {}): DecisionVoteProps => ({
    id: 'v1', decision_id: 'd1', round: 1,
    apartment_id: 'apt1', quote_id: 'q1', voted_by_user_id: 'u1', ...o,
});

describe('DecisionVote Entity', () => {
    it('creates valid vote with defaults', () => {
        const v = new DecisionVote(base());
        expect(v.round).toBe(1);
        expect(v.created_at).toBeInstanceOf(Date);
    });
    it('requires positive round', () => {
        expect(() => new DecisionVote(base({ round: 0 }))).toThrow();
    });
    it('requires apartment_id and quote_id', () => {
        expect(() => new DecisionVote(base({ apartment_id: '' }))).toThrow();
        expect(() => new DecisionVote(base({ quote_id: '' }))).toThrow();
    });
});
```

- [ ] **Step 2: Verify failure**

Run: `bun test tests/modules/decisions/domain/DecisionVote.test.ts`

- [ ] **Step 3: Implement**

```ts
// src/modules/decisions/domain/entities/DecisionVote.ts
import { DomainError } from '@/core/errors';

export interface DecisionVoteProps {
    id: string;
    decision_id: string;
    round: number;
    apartment_id: string;
    quote_id: string;
    voted_by_user_id: string | null;
    created_at?: Date;
}

export class DecisionVote {
    constructor(private props: DecisionVoteProps) {
        if (!props.decision_id) throw new DomainError('decision_id required', 'VALIDATION_ERROR', 400);
        if (!(props.round >= 1)) throw new DomainError('round must be >= 1', 'VALIDATION_ERROR', 400);
        if (!props.apartment_id) throw new DomainError('apartment_id required', 'VALIDATION_ERROR', 400);
        if (!props.quote_id) throw new DomainError('quote_id required', 'VALIDATION_ERROR', 400);
        this.props.created_at ??= new Date();
    }

    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get round() { return this.props.round; }
    get apartment_id() { return this.props.apartment_id; }
    get quote_id() { return this.props.quote_id; }
    get voted_by_user_id() { return this.props.voted_by_user_id; }
    get created_at() { return this.props.created_at!; }

    toJSON() { return { ...this.props }; }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```sh
git commit -am "feat(decisions): add DecisionVote entity"
```

---

### Task 8: DecisionAuditLog entity

**Files:**
- Create: `src/modules/decisions/domain/entities/DecisionAuditLog.ts`
- Test: `tests/modules/decisions/domain/DecisionAuditLog.test.ts`

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'bun:test';
import { DecisionAuditLog, AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

describe('DecisionAuditLog', () => {
    it('creates with defaults', () => {
        const e = new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: AuditEvent.CREATED,
            actor_user_id: 'u1', payload: { foo: 1 },
        });
        expect(e.event).toBe(AuditEvent.CREATED);
        expect(e.created_at).toBeInstanceOf(Date);
    });
    it('rejects unknown event', () => {
        expect(() => new DecisionAuditLog({
            id: 'a1', decision_id: 'd1', event: 'UNKNOWN' as any,
            actor_user_id: 'u1', payload: null,
        })).toThrow();
    });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

```ts
// src/modules/decisions/domain/entities/DecisionAuditLog.ts
import { DomainError } from '@/core/errors';

export enum AuditEvent {
    CREATED = 'CREATED',
    DEADLINE_EXTENDED = 'DEADLINE_EXTENDED',
    CANCELLED = 'CANCELLED',
    QUOTE_DELETED = 'QUOTE_DELETED',
    FINALIZED = 'FINALIZED',
    TIEBREAK_OPENED = 'TIEBREAK_OPENED',
    WINNER_SET_MANUAL = 'WINNER_SET_MANUAL',
    CHARGE_GENERATED = 'CHARGE_GENERATED',
    PHASE_ADVANCED = 'PHASE_ADVANCED',
}

export interface DecisionAuditLogProps {
    id: string;
    decision_id: string;
    event: AuditEvent;
    actor_user_id: string | null;
    payload: Record<string, unknown> | null;
    created_at?: Date;
}

export class DecisionAuditLog {
    constructor(private props: DecisionAuditLogProps) {
        if (!Object.values(AuditEvent).includes(props.event)) {
            throw new DomainError('invalid audit event', 'VALIDATION_ERROR', 400);
        }
        this.props.created_at ??= new Date();
    }
    get id() { return this.props.id; }
    get decision_id() { return this.props.decision_id; }
    get event() { return this.props.event; }
    get actor_user_id() { return this.props.actor_user_id; }
    get payload() { return this.props.payload; }
    get created_at() { return this.props.created_at!; }
    toJSON() { return { ...this.props }; }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```sh
git commit -am "feat(decisions): add DecisionAuditLog entity"
```

---

### Task 9: TallyService (pure)

**Files:**
- Create: `src/modules/decisions/domain/services/TallyService.ts`
- Test: `tests/modules/decisions/domain/TallyService.test.ts`

- [ ] **Step 1: Tests**

```ts
import { describe, it, expect } from 'bun:test';
import { computeTally, TallyVote } from '@/modules/decisions/domain/services/TallyService';

const v = (apt: string, quote: string, round = 1): TallyVote => ({ apartment_id: apt, quote_id: quote, round });

describe('TallyService.computeTally', () => {
    it('zero votes → empty tally, is_tied=true, reason=NO_VOTES', () => {
        const r = computeTally([], 1);
        expect(r.is_tied).toBe(true);
        expect(r.tied_quote_ids).toEqual([]);
        expect(r.winner_quote_id).toBeNull();
        expect(r.reason).toBe('NO_VOTES');
    });
    it('single winner', () => {
        const r = computeTally([v('a','q1'), v('b','q1'), v('c','q2')], 1);
        expect(r.is_tied).toBe(false);
        expect(r.winner_quote_id).toBe('q1');
        expect(r.totals['q1']).toBe(2);
        expect(r.totals['q2']).toBe(1);
    });
    it('two-way tie', () => {
        const r = computeTally([v('a','q1'), v('b','q2')], 1);
        expect(r.is_tied).toBe(true);
        expect(r.tied_quote_ids.sort()).toEqual(['q1','q2']);
        expect(r.winner_quote_id).toBeNull();
    });
    it('three-way tie', () => {
        const r = computeTally([v('a','q1'), v('b','q2'), v('c','q3')], 1);
        expect(r.is_tied).toBe(true);
        expect(r.tied_quote_ids.length).toBe(3);
    });
    it('round 2 ignores round 1 votes', () => {
        const all = [v('a','q1',1), v('b','q1',1), v('c','q1',2), v('d','q2',2)];
        const r = computeTally(all, 2);
        expect(r.totals['q1']).toBe(1);
        expect(r.totals['q2']).toBe(1);
        expect(r.is_tied).toBe(true);
    });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

```ts
// src/modules/decisions/domain/services/TallyService.ts
export interface TallyVote {
    apartment_id: string;
    quote_id: string;
    round: number;
}

export interface TallyResult {
    totals: Record<string, number>;
    winner_quote_id: string | null;
    is_tied: boolean;
    tied_quote_ids: string[];
    total_votes: number;
    reason?: 'NO_VOTES';
}

export function computeTally(votes: TallyVote[], round: number): TallyResult {
    const filtered = votes.filter(v => v.round === round);
    const totals: Record<string, number> = {};
    for (const v of filtered) totals[v.quote_id] = (totals[v.quote_id] ?? 0) + 1;
    if (filtered.length === 0) {
        return { totals, winner_quote_id: null, is_tied: true, tied_quote_ids: [], total_votes: 0, reason: 'NO_VOTES' };
    }
    const max = Math.max(...Object.values(totals));
    const winners = Object.entries(totals).filter(([, n]) => n === max).map(([qid]) => qid);
    if (winners.length === 1) {
        return { totals, winner_quote_id: winners[0], is_tied: false, tied_quote_ids: [], total_votes: filtered.length };
    }
    return { totals, winner_quote_id: null, is_tied: true, tied_quote_ids: winners, total_votes: filtered.length };
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```sh
git commit -am "feat(decisions): add TallyService pure tally computation"
```

---

## Phase 3 — Repository contracts

### Task 10: Repository interfaces

**Files:**
- Create: `src/modules/decisions/domain/repository.ts`

- [ ] **Step 1: Define interfaces**

```ts
// src/modules/decisions/domain/repository.ts
import { Decision, DecisionStatus } from './entities/Decision';
import { DecisionQuote } from './entities/DecisionQuote';
import { DecisionVote } from './entities/DecisionVote';
import { DecisionAuditLog, AuditEvent } from './entities/DecisionAuditLog';

export interface PaginationOptions { page: number; limit: number; }
export interface PaginatedResult<T> { items: T[]; total: number; }

export interface DecisionListFilters {
    building_id?: string;
    statuses?: DecisionStatus[];
    created_by?: string;
    search?: string;
    has_my_vote_for_user_id?: string; // when set, filter where user has cast a vote
    pagination: PaginationOptions;
}

export interface DecisionRepository {
    create(d: Decision): Promise<Decision>;
    update(d: Decision): Promise<Decision>;
    findById(id: string): Promise<Decision | null>;
    findByIdLocked(id: string): Promise<Decision | null>;        // SELECT ... FOR UPDATE
    list(filters: DecisionListFilters): Promise<PaginatedResult<Decision>>;
    acquireFinalizeLock(id: string): Promise<void>;              // pg_advisory_xact_lock
}

export interface DecisionQuoteRepository {
    create(q: DecisionQuote): Promise<DecisionQuote>;
    update(q: DecisionQuote): Promise<DecisionQuote>;
    findById(id: string): Promise<DecisionQuote | null>;
    listForDecision(decisionId: string, includeDeleted?: boolean): Promise<DecisionQuote[]>;
}

export interface DecisionVoteRepository {
    create(v: DecisionVote): Promise<DecisionVote>;
    listForDecision(decisionId: string, round?: number): Promise<DecisionVote[]>;
    findByDecisionApartmentRound(
        decisionId: string, apartmentId: string, round: number
    ): Promise<DecisionVote | null>;
    countByQuote(decisionId: string, round: number): Promise<Record<string, number>>;
}

export interface DecisionAuditLogRepository {
    record(args: {
        decision_id: string;
        event: AuditEvent;
        actor_user_id: string | null;
        payload?: Record<string, unknown> | null;
    }): Promise<DecisionAuditLog>;
    listForDecision(decisionId: string): Promise<DecisionAuditLog[]>;
}
```

- [ ] **Step 2: Commit**

```sh
git add src/modules/decisions/domain/repository.ts
git commit -m "feat(decisions): add repository interfaces"
```

---

## Phase 4 — Use cases (TDD with in-memory fakes)

> **Setup**: First create in-memory fakes shared by all use case tests.

### Task 11: In-memory repo fakes

**Files:**
- Create: `tests/modules/decisions/fakes.ts`

- [ ] **Step 1: Implement fakes**

```ts
// tests/modules/decisions/fakes.ts
import { Decision } from '@/modules/decisions/domain/entities/Decision';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { DecisionAuditLog, AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
    DecisionRepository, DecisionQuoteRepository, DecisionVoteRepository,
    DecisionAuditLogRepository, DecisionListFilters, PaginatedResult,
} from '@/modules/decisions/domain/repository';
import { randomUUID } from 'crypto';

export class InMemoryDecisionRepo implements DecisionRepository {
    public store = new Map<string, Decision>();
    async create(d: Decision) { this.store.set(d.id, d); return d; }
    async update(d: Decision) { this.store.set(d.id, d); return d; }
    async findById(id: string) { return this.store.get(id) ?? null; }
    async findByIdLocked(id: string) { return this.findById(id); }
    async acquireFinalizeLock(_id: string) { /* no-op in memory */ }
    async list(f: DecisionListFilters): Promise<PaginatedResult<Decision>> {
        let items = [...this.store.values()];
        if (f.building_id) items = items.filter(d => d.building_id === f.building_id);
        if (f.statuses?.length) items = items.filter(d => f.statuses!.includes(d.status));
        if (f.created_by) items = items.filter(d => d.created_by === f.created_by);
        if (f.search) items = items.filter(d => d.title.toLowerCase().includes(f.search!.toLowerCase()));
        const total = items.length;
        const start = (f.pagination.page - 1) * f.pagination.limit;
        items = items.slice(start, start + f.pagination.limit);
        return { items, total };
    }
}

export class InMemoryQuoteRepo implements DecisionQuoteRepository {
    public store = new Map<string, DecisionQuote>();
    async create(q: DecisionQuote) { this.store.set(q.id, q); return q; }
    async update(q: DecisionQuote) { this.store.set(q.id, q); return q; }
    async findById(id: string) { return this.store.get(id) ?? null; }
    async listForDecision(did: string, includeDeleted = false) {
        return [...this.store.values()].filter(q =>
            q.decision_id === did && (includeDeleted || !q.isDeleted));
    }
}

export class InMemoryVoteRepo implements DecisionVoteRepository {
    public store = new Map<string, DecisionVote>();
    async create(v: DecisionVote) {
        const key = `${v.decision_id}|${v.round}|${v.apartment_id}`;
        if ([...this.store.values()].some(x =>
            x.decision_id === v.decision_id && x.round === v.round && x.apartment_id === v.apartment_id)) {
            const err: any = new Error('unique violation');
            err.code = 'VOTE_ALREADY_CAST';
            throw err;
        }
        this.store.set(key, v); return v;
    }
    async listForDecision(did: string, round?: number) {
        return [...this.store.values()].filter(v =>
            v.decision_id === did && (round === undefined || v.round === round));
    }
    async findByDecisionApartmentRound(did: string, apt: string, r: number) {
        return [...this.store.values()].find(v =>
            v.decision_id === did && v.apartment_id === apt && v.round === r) ?? null;
    }
    async countByQuote(did: string, round: number) {
        const out: Record<string, number> = {};
        for (const v of await this.listForDecision(did, round)) {
            out[v.quote_id] = (out[v.quote_id] ?? 0) + 1;
        }
        return out;
    }
}

export class InMemoryAuditRepo implements DecisionAuditLogRepository {
    public store: DecisionAuditLog[] = [];
    async record(args: { decision_id: string; event: AuditEvent; actor_user_id: string | null; payload?: any }) {
        const e = new DecisionAuditLog({
            id: randomUUID(), decision_id: args.decision_id, event: args.event,
            actor_user_id: args.actor_user_id, payload: args.payload ?? null,
        });
        this.store.push(e);
        return e;
    }
    async listForDecision(did: string) {
        return this.store.filter(e => e.decision_id === did);
    }
}
```

- [ ] **Step 2: Commit**

```sh
git add tests/modules/decisions/fakes.ts
git commit -m "test(decisions): add in-memory repo fakes"
```

---

### Task 12: CreateDecision use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/CreateDecision.ts`
- Test: `tests/modules/decisions/application/CreateDecision.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from 'bun:test';
import { CreateDecision } from '@/modules/decisions/application/use-cases/CreateDecision';
import { InMemoryDecisionRepo, InMemoryAuditRepo } from '../fakes';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

const future = (ms: number) => new Date(Date.now() + ms);

describe('CreateDecision', () => {
    it('creates a decision and audit-logs CREATED', async () => {
        const repo = new InMemoryDecisionRepo();
        const audit = new InMemoryAuditRepo();
        const uc = new CreateDecision(repo, audit);
        const d = await uc.execute({
            building_id: 'b1', actor_user_id: 'u1', title: 'Reparación portón',
            reception_deadline: future(60_000), voting_deadline: future(120_000),
        });
        expect(d.title).toBe('Reparación portón');
        expect(d.created_by).toBe('u1');
        const logs = await audit.listForDecision(d.id);
        expect(logs.length).toBe(1);
        expect(logs[0].event).toBe(AuditEvent.CREATED);
    });
    it('rejects bad deadlines', async () => {
        const uc = new CreateDecision(new InMemoryDecisionRepo(), new InMemoryAuditRepo());
        await expect(uc.execute({
            building_id: 'b1', actor_user_id: 'u1', title: 'foo bar',
            reception_deadline: future(60_000), voting_deadline: future(30_000),
        })).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

```ts
// src/modules/decisions/application/use-cases/CreateDecision.ts
import { randomUUID } from 'crypto';
import { Decision } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
    DecisionRepository, DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';

export interface CreateDecisionInput {
    building_id: string;
    actor_user_id: string;
    title: string;
    description?: string;
    photo_url?: string;
    reception_deadline: Date;
    voting_deadline: Date;
    tiebreak_duration_hours?: number;
}

export class CreateDecision {
    constructor(
        private readonly repo: DecisionRepository,
        private readonly audit: DecisionAuditLogRepository,
    ) {}
    async execute(input: CreateDecisionInput): Promise<Decision> {
        const d = new Decision({
            id: randomUUID(),
            building_id: input.building_id,
            created_by: input.actor_user_id,
            title: input.title,
            description: input.description ?? null,
            photo_url: input.photo_url ?? null,
            reception_deadline: input.reception_deadline,
            voting_deadline: input.voting_deadline,
            tiebreak_duration_hours: input.tiebreak_duration_hours,
        });
        const created = await this.repo.create(d);
        await this.audit.record({
            decision_id: created.id, event: AuditEvent.CREATED,
            actor_user_id: input.actor_user_id,
            payload: {
                title: input.title,
                reception_deadline: input.reception_deadline,
                voting_deadline: input.voting_deadline,
            },
        });
        return created;
    }
}
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```sh
git commit -am "feat(decisions): add CreateDecision use case"
```

---

> **NOTE TO IMPLEMENTER:** Tasks 13-25 follow the same TDD pattern. For brevity I describe each in compressed form. Each task = test + implementation + commit.

### Task 13: ListDecisions use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/ListDecisions.ts`
- Test: `tests/modules/decisions/application/ListDecisions.test.ts`

Wraps `repo.list(filters)`. Builds filters from input. Uses `parsePaginationFilters` from `@/core/domain/pagination`. Tests: pagination, filtering by status comma-list, filter by building.

```ts
// Implementation sketch
import { parsePaginationFilters, buildPaginatedResult, PaginatedResult } from '@/core/domain/pagination';
import { DecisionRepository, DecisionListFilters } from '@/modules/decisions/domain/repository';
import { Decision, DecisionStatus } from '@/modules/decisions/domain/entities/Decision';

export interface ListDecisionsInput {
    page?: number; limit?: number | 'all';
    building_id?: string; statuses?: string;
    created_by?: string; search?: string; has_my_vote_user_id?: string;
}
export class ListDecisions {
    constructor(private readonly repo: DecisionRepository) {}
    async execute(i: ListDecisionsInput) {
        const pagination = parsePaginationFilters({ page: i.page, limit: i.limit });
        const statuses = i.statuses
            ? i.statuses.split(',').filter(Boolean) as DecisionStatus[]
            : undefined;
        const result = await this.repo.list({
            building_id: i.building_id, statuses,
            created_by: i.created_by, search: i.search,
            has_my_vote_for_user_id: i.has_my_vote_user_id,
            pagination,
        });
        return buildPaginatedResult(result.items, result.total, pagination);
    }
}
```

- [ ] Write 4-5 tests covering filters + pagination
- [ ] Verify failures, implement, run, commit

```sh
git commit -am "feat(decisions): add ListDecisions use case"
```

---

### Task 14: GetDecision use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/GetDecision.ts`
- Test: `tests/modules/decisions/application/GetDecision.test.ts`

Returns `{ decision, quotes, my_vote, tally }`. Uses `computeTally` for tally.

```ts
import { DecisionRepository, DecisionQuoteRepository, DecisionVoteRepository } from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';
import { DomainError } from '@/core/errors';

export class GetDecision {
    constructor(
        private decisionRepo: DecisionRepository,
        private quoteRepo: DecisionQuoteRepository,
        private voteRepo: DecisionVoteRepository,
    ) {}
    async execute(id: string, opts: { caller_user_id: string | null }) {
        const decision = await this.decisionRepo.findById(id);
        if (!decision) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);
        const quotes = await this.quoteRepo.listForDecision(id);
        const allVotes = await this.voteRepo.listForDecision(id);
        const tally = computeTally(allVotes.map(v => ({
            apartment_id: v.apartment_id, quote_id: v.quote_id, round: v.round,
        })), decision.current_round);
        const my_vote = opts.caller_user_id
            ? allVotes.find(v => v.voted_by_user_id === opts.caller_user_id && v.round === decision.current_round) ?? null
            : null;
        return { decision, quotes, tally, my_vote };
    }
}
```

- [ ] Tests: not-found, found with quotes/votes, my_vote present/absent
- [ ] Commit: `feat(decisions): add GetDecision use case`

---

### Task 15: UploadQuote use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/UploadQuote.ts`
- Test: `tests/modules/decisions/application/UploadQuote.test.ts`

Validates: decision exists, status is RECEPTION, building accessible. Persists `DecisionQuote` with `file_url` (assumed already uploaded by storage service in route layer).

```ts
import { randomUUID } from 'crypto';
import { DecisionQuote } from '@/modules/decisions/domain/entities/DecisionQuote';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionRepository, DecisionQuoteRepository } from '@/modules/decisions/domain/repository';
import { DomainError } from '@/core/errors';

export interface UploadQuoteInput {
    decision_id: string; uploader_user_id: string; uploader_unit_id?: string | null;
    provider_name: string; amount: number; notes?: string; file_url: string;
}
export class UploadQuote {
    constructor(private decisions: DecisionRepository, private quotes: DecisionQuoteRepository) {}
    async execute(i: UploadQuoteInput): Promise<DecisionQuote> {
        const d = await this.decisions.findById(i.decision_id);
        if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);
        if (d.status !== DecisionStatus.RECEPTION) {
            throw new DomainError('quotes only allowed in RECEPTION', 'DECISION_WRONG_STATUS', 422);
        }
        const q = new DecisionQuote({
            id: randomUUID(), decision_id: i.decision_id,
            uploader_user_id: i.uploader_user_id, uploader_unit_id: i.uploader_unit_id ?? null,
            provider_name: i.provider_name, amount: i.amount, notes: i.notes ?? null,
            file_url: i.file_url,
        });
        return this.quotes.create(q);
    }
}
```

- [ ] Tests: happy, decision-not-found, wrong status
- [ ] Commit: `feat(decisions): add UploadQuote use case`

---

### Task 16: ListQuotes use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/ListQuotes.ts`
- Test: `tests/modules/decisions/application/ListQuotes.test.ts`

Trivial: `quoteRepo.listForDecision(id, includeDeleted=false)`. With opt for admin/board to include deleted.

- [ ] Test default + includeDeleted
- [ ] Commit: `feat(decisions): add ListQuotes use case`

---

### Task 17: DeleteQuote use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/DeleteQuote.ts`
- Test: `tests/modules/decisions/application/DeleteQuote.test.ts`

Branching:
- if `actor_user_id === quote.uploader_user_id` AND decision in RECEPTION → reason="self-deleted by uploader"
- else require role admin/board (caller passes `actor_role`) and `reason` non-empty

```ts
import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { DecisionRepository, DecisionQuoteRepository, DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';

export type ActorRole = 'admin' | 'board' | 'resident';
export interface DeleteQuoteInput {
    decision_id: string; quote_id: string;
    actor_user_id: string; actor_role: ActorRole;
    reason?: string;
}

export class DeleteQuote {
    constructor(
        private decisions: DecisionRepository,
        private quotes: DecisionQuoteRepository,
        private audit: DecisionAuditLogRepository,
    ) {}
    async execute(i: DeleteQuoteInput) {
        const q = await this.quotes.findById(i.quote_id);
        if (!q || q.decision_id !== i.decision_id) {
            throw new DomainError('quote not found', 'QUOTE_NOT_FOUND', 404);
        }
        const d = await this.decisions.findById(i.decision_id);
        if (!d) throw new DomainError('decision not found', 'DECISION_NOT_FOUND', 404);
        const isSelf = q.uploader_user_id === i.actor_user_id;
        const isAdminOrBoard = i.actor_role === 'admin' || i.actor_role === 'board';
        if (isSelf && d.status === DecisionStatus.RECEPTION) {
            q.softDelete(i.actor_user_id, 'self-deleted by uploader');
        } else if (isAdminOrBoard) {
            if (!i.reason?.trim()) {
                throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
            }
            q.softDelete(i.actor_user_id, i.reason);
        } else {
            throw new DomainError('not allowed', 'DECISION_FORBIDDEN_ROLE', 403);
        }
        const updated = await this.quotes.update(q);
        await this.audit.record({
            decision_id: d.id, event: AuditEvent.QUOTE_DELETED,
            actor_user_id: i.actor_user_id,
            payload: { quote_id: q.id, reason: q.deletion_reason },
        });
        return updated;
    }
}
```

- [ ] Tests: self-delete-in-RECEPTION, self-delete-in-VOTING-rejected, admin-with-reason, admin-without-reason-rejected, resident-other-quote-rejected
- [ ] Commit: `feat(decisions): add DeleteQuote use case`

---

### Task 18: CastVote use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/CastVote.ts`
- Test: `tests/modules/decisions/application/CastVote.test.ts`

Validations:
- decision found and in `VOTING`, voting_deadline > now
- quote belongs to decision, not deleted
- if `current_round > 1`, quote must be in tied-from-round-1 set (compute via `voteRepo.countByQuote(decision_id, 1)`)
- vote insert relies on UNIQUE constraint to bounce duplicates (in fake we throw `VOTE_ALREADY_CAST`)
- caller's `apartment_id` must match the input (route layer validates `profile_units` membership)

```ts
import { randomUUID } from 'crypto';
import { DomainError } from '@/core/errors';
import { DecisionVote } from '@/modules/decisions/domain/entities/DecisionVote';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import {
    DecisionRepository, DecisionQuoteRepository, DecisionVoteRepository,
} from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';

export interface CastVoteInput {
    decision_id: string; apartment_id: string; quote_id: string;
    voter_user_id: string;
}
export class CastVote {
    constructor(
        private decisions: DecisionRepository,
        private quotes: DecisionQuoteRepository,
        private votes: DecisionVoteRepository,
    ) {}
    async execute(i: CastVoteInput) {
        const d = await this.decisions.findById(i.decision_id);
        if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
        if (d.status !== DecisionStatus.VOTING) throw new DomainError('not voting', 'DECISION_WRONG_STATUS', 422);
        if (d.voting_deadline.getTime() <= Date.now()) {
            throw new DomainError('voting closed', 'DECISION_WRONG_STATUS', 422);
        }
        const q = await this.quotes.findById(i.quote_id);
        if (!q || q.decision_id !== d.id) throw new DomainError('quote not found', 'QUOTE_NOT_FOUND', 404);
        if (q.isDeleted) throw new DomainError('quote deleted', 'QUOTE_DELETED', 422);
        if (d.current_round > 1) {
            const previousRoundVotes = await this.votes.listForDecision(d.id, d.current_round - 1);
            const tally = computeTally(previousRoundVotes.map(v => ({
                apartment_id: v.apartment_id, quote_id: v.quote_id, round: v.round,
            })), d.current_round - 1);
            if (!tally.tied_quote_ids.includes(q.id)) {
                throw new DomainError('quote not in tiebreak set', 'QUOTE_NOT_IN_TIEBREAK', 422);
            }
        }
        try {
            return await this.votes.create(new DecisionVote({
                id: randomUUID(), decision_id: d.id, round: d.current_round,
                apartment_id: i.apartment_id, quote_id: i.quote_id,
                voted_by_user_id: i.voter_user_id,
            }));
        } catch (e: any) {
            if (e.code === 'VOTE_ALREADY_CAST' || e.code === '23505') {
                throw new DomainError('already voted', 'VOTE_ALREADY_CAST', 409);
            }
            throw e;
        }
    }
}
```

- [ ] Tests: happy round 1, duplicate 409, wrong status, quote deleted, round 2 quote-not-in-tiebreak rejected, round 2 quote-in-tiebreak accepted
- [ ] Commit: `feat(decisions): add CastVote use case`

---

### Task 19: ListVotes use case

Trivial — wraps `voteRepo.listForDecision(decisionId, round?)`. Apartment label join handled in repository (Supabase) layer; in-memory tests just check round filter.

- [ ] One test: `feat(decisions): add ListVotes use case`

---

### Task 20: GetResults use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/GetResults.ts`
- Test: `tests/modules/decisions/application/GetResults.test.ts`

Computes the tally DTO including `participation_pct`. Needs an injected service for "total apartments in building" (count of `units` for that building). For tests, accept a callback.

```ts
import { DomainError } from '@/core/errors';
import { DecisionRepository, DecisionQuoteRepository, DecisionVoteRepository } from '@/modules/decisions/domain/repository';
import { computeTally } from '@/modules/decisions/domain/services/TallyService';

export type TotalApartmentsLookup = (buildingId: string) => Promise<number>;

export interface ResultsDTO {
    round: number;
    status: string;
    total_apartments: number;
    total_votes: number;
    participation_pct: number;
    tallies: Array<{ quote_id: string; provider_name: string; amount: number; votes: number; pct: number }>;
    winner_quote_id: string | null;
    is_tied: boolean;
}
export class GetResults {
    constructor(
        private decisions: DecisionRepository,
        private quotes: DecisionQuoteRepository,
        private votes: DecisionVoteRepository,
        private totalApartments: TotalApartmentsLookup,
    ) {}
    async execute(decisionId: string, round?: number): Promise<ResultsDTO> {
        const d = await this.decisions.findById(decisionId);
        if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
        const r = round ?? d.current_round;
        const quotes = await this.quotes.listForDecision(decisionId, true);
        const votes = await this.votes.listForDecision(decisionId, r);
        const tally = computeTally(votes.map(v => ({
            apartment_id: v.apartment_id, quote_id: v.quote_id, round: v.round,
        })), r);
        const totalApt = await this.totalApartments(d.building_id);
        const tallies = quotes.map(q => {
            const votesForQ = tally.totals[q.id] ?? 0;
            return {
                quote_id: q.id, provider_name: q.provider_name, amount: q.amount,
                votes: votesForQ,
                pct: tally.total_votes ? (votesForQ / tally.total_votes) * 100 : 0,
            };
        });
        return {
            round: r, status: d.status,
            total_apartments: totalApt,
            total_votes: tally.total_votes,
            participation_pct: totalApt ? (tally.total_votes / totalApt) * 100 : 0,
            tallies,
            winner_quote_id: d.status === 'RESOLVED' ? d.winner_quote_id : null,
            is_tied: tally.is_tied,
        };
    }
}
```

- [ ] Tests: zero apts → 0 pct, normal tally, RESOLVED includes winner
- [ ] Commit: `feat(decisions): add GetResults use case`

---

### Task 21: FinalizeDecision use case

**Files:**
- Create: `src/modules/decisions/application/use-cases/FinalizeDecision.ts`
- Test: `tests/modules/decisions/application/FinalizeDecision.test.ts`

Most complex. Logic per spec §6.5:
- acquire advisory lock
- re-fetch with lock
- branch by status:
  - `RECEPTION` + reception passed → `advanceToVoting()` + audit `PHASE_ADVANCED`. Return `{ outcome: 'ADVANCED_TO_VOTING' }`.
  - `VOTING` + voting passed:
    - get active quotes
    - if `quotes.length === 0` → `markTiebreakPendingManual()` + audit `TIEBREAK_OPENED reason=NO_ACTIVE_QUOTES`
    - get votes for current_round, compute tally
    - if `tally.total_votes === 0` → `markTiebreakPendingManual()` + audit `TIEBREAK_OPENED reason=NO_VOTES_CAST`
    - if `!tally.is_tied` → `resolve(winner_quote_id)` + audit `FINALIZED`
    - if tied + round 1 → `openTiebreak()` + audit `TIEBREAK_OPENED reason=TIE_ROUND_1`
    - if tied + round >= 2 → `markTiebreakPendingManual()` + audit `TIEBREAK_OPENED reason=TIE_ROUND_2_MANUAL`
- idempotent: if `finalized_at` already set for current state, return current decision

Test fakes need to expose `acquireFinalizeLock` (no-op).

- [ ] 8 tests covering each branch
- [ ] Commit: `feat(decisions): add FinalizeDecision use case`

---

### Task 22: ResolveTiebreak use case

```ts
import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionRepository, DecisionQuoteRepository, DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export interface ResolveTiebreakInput { decision_id: string; winner_quote_id: string; actor_user_id: string; }
export class ResolveTiebreak {
    constructor(
        private decisions: DecisionRepository,
        private quotes: DecisionQuoteRepository,
        private audit: DecisionAuditLogRepository,
    ) {}
    async execute(i: ResolveTiebreakInput) {
        const d = await this.decisions.findById(i.decision_id);
        if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
        if (d.status !== DecisionStatus.TIEBREAK_PENDING) {
            throw new DomainError('not tiebreak pending', 'TIEBREAK_MANUAL_NOT_ALLOWED', 422);
        }
        const q = await this.quotes.findById(i.winner_quote_id);
        if (!q || q.decision_id !== d.id || q.isDeleted) {
            throw new DomainError('invalid winner quote', 'QUOTE_NOT_FOUND', 404);
        }
        d.resolve(q.id);
        const updated = await this.decisions.update(d);
        await this.audit.record({
            decision_id: d.id, event: AuditEvent.WINNER_SET_MANUAL,
            actor_user_id: i.actor_user_id, payload: { winner_quote_id: q.id },
        });
        return updated;
    }
}
```

- [ ] Tests: not in TIEBREAK_PENDING rejected; happy path
- [ ] Commit: `feat(decisions): add ResolveTiebreak use case`

---

### Task 23: ExtendDeadlines use case

```ts
import { DomainError } from '@/core/errors';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import { DecisionRepository, DecisionAuditLogRepository } from '@/modules/decisions/domain/repository';

export interface ExtendDeadlinesInput {
    decision_id: string; reception_deadline?: Date; voting_deadline?: Date;
    reason: string; actor_user_id: string;
}
export class ExtendDeadlines {
    constructor(private decisions: DecisionRepository, private audit: DecisionAuditLogRepository) {}
    async execute(i: ExtendDeadlinesInput) {
        if (!i.reason?.trim()) throw new DomainError('reason required', 'VALIDATION_ERROR', 400);
        const d = await this.decisions.findById(i.decision_id);
        if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
        const old = { reception_deadline: d.reception_deadline, voting_deadline: d.voting_deadline };
        d.extendDeadlines({ reception_deadline: i.reception_deadline, voting_deadline: i.voting_deadline });
        const updated = await this.decisions.update(d);
        await this.audit.record({
            decision_id: d.id, event: AuditEvent.DEADLINE_EXTENDED,
            actor_user_id: i.actor_user_id,
            payload: { old, new: { reception_deadline: d.reception_deadline, voting_deadline: d.voting_deadline }, reason: i.reason },
        });
        return updated;
    }
}
```

- [ ] Tests: reason missing rejected; valid extension; cannot extend reception in VOTING
- [ ] Commit: `feat(decisions): add ExtendDeadlines use case`

---

### Task 24: CancelDecision use case

Similar shape: validate, call `d.cancel(reason)`, persist, audit `CANCELLED`.

- [ ] Tests: terminal status rejected; happy
- [ ] Commit: `feat(decisions): add CancelDecision use case`

---

### Task 25: GetAuditLog use case

Trivial wrapper around `auditRepo.listForDecision(id)`.

- [ ] One test
- [ ] Commit: `feat(decisions): add GetAuditLog use case`

---

## Phase 5 — Charge adapters (port + impls)

### Task 26: ChargeGenerator port

**Files:**
- Create: `src/modules/decisions/application/ports/ChargeGenerator.ts`

```ts
export interface ChargeRequest {
    decision_id: string;
    building_id: string;
    amount: number;
    description: string;
    actor_user_id: string;
    overrides?: Record<string, unknown>;
}
export interface ChargeResult { type: 'INVOICE' | 'ASSESSMENT'; id: string; }
export interface InvoiceChargeGenerator { generate(req: ChargeRequest): Promise<ChargeResult>; }
export interface AssessmentChargeGenerator { generate(req: ChargeRequest): Promise<ChargeResult>; }
```

- [ ] Commit: `feat(decisions): add ChargeGenerator port interfaces`

---

### Task 27: GenerateCharge use case

```ts
import { DomainError } from '@/core/errors';
import { DecisionStatus } from '@/modules/decisions/domain/entities/Decision';
import { AuditEvent } from '@/modules/decisions/domain/entities/DecisionAuditLog';
import {
    DecisionRepository, DecisionQuoteRepository, DecisionAuditLogRepository,
} from '@/modules/decisions/domain/repository';
import {
    InvoiceChargeGenerator, AssessmentChargeGenerator,
} from '@/modules/decisions/application/ports/ChargeGenerator';

export interface GenerateChargeInput {
    decision_id: string; type: 'INVOICE' | 'ASSESSMENT';
    actor_user_id: string;
    description_override?: string; amount_override?: number;
    overrides?: Record<string, unknown>;
}
export class GenerateCharge {
    constructor(
        private decisions: DecisionRepository,
        private quotes: DecisionQuoteRepository,
        private audit: DecisionAuditLogRepository,
        private invoiceGen: InvoiceChargeGenerator,
        private assessmentGen: AssessmentChargeGenerator,
    ) {}
    async execute(i: GenerateChargeInput) {
        const d = await this.decisions.findById(i.decision_id);
        if (!d) throw new DomainError('not found', 'DECISION_NOT_FOUND', 404);
        if (d.status !== DecisionStatus.RESOLVED) {
            throw new DomainError('not resolved', 'DECISION_WRONG_STATUS', 422);
        }
        if (d.resulting_id) {
            throw new DomainError('already charged', 'DECISION_ALREADY_CHARGED', 409);
        }
        if (!d.winner_quote_id) {
            throw new DomainError('no winner', 'DECISION_NO_WINNER', 422);
        }
        const winner = await this.quotes.findById(d.winner_quote_id);
        if (!winner) throw new DomainError('winner missing', 'QUOTE_NOT_FOUND', 404);
        const req = {
            decision_id: d.id, building_id: d.building_id,
            amount: i.amount_override ?? winner.amount,
            description: i.description_override ?? d.title,
            actor_user_id: i.actor_user_id, overrides: i.overrides,
        };
        const result = i.type === 'INVOICE'
            ? await this.invoiceGen.generate(req)
            : await this.assessmentGen.generate(req);
        d.attachCharge(result.type, result.id);
        await this.decisions.update(d);
        await this.audit.record({
            decision_id: d.id, event: AuditEvent.CHARGE_GENERATED,
            actor_user_id: i.actor_user_id, payload: result,
        });
        return { decision: d, resulting: result };
    }
}
```

- [ ] Tests with fake `InvoiceChargeGenerator` / `AssessmentChargeGenerator`: happy INVOICE, happy ASSESSMENT, double-call 409, not RESOLVED 422
- [ ] Commit: `feat(decisions): add GenerateCharge use case`

---

### Task 28: Adapter implementations

**Files:**
- Create: `src/modules/decisions/infrastructure/adapters/InvoiceChargeAdapter.ts`
- Create: `src/modules/decisions/infrastructure/adapters/AssessmentChargeAdapter.ts`

Each adapter wraps an existing use case from `billing` and `petty-cash` modules respectively. Implementer must read those modules' `CreateInvoice` and `GenerateAssessments` use cases and adapt the API. Outline:

```ts
// InvoiceChargeAdapter.ts — wraps billing CreateInvoice
// 1. Construct CreateInvoice with the project's existing repo dependencies.
// 2. execute({ building_id, amount, description, type: 'EXTRAORDINARY', tag: 'NORMAL', ... }).
// 3. Return { type: 'INVOICE', id: invoice.id }.
```

```ts
// AssessmentChargeAdapter.ts — wraps petty-cash GenerateAssessments
// 1. Look up the building's petty-cash fund (existing repo).
// 2. Call GenerateAssessments with { fund_id, period: current YYYY-MM, description, amount, category? }.
// 3. Return { type: 'ASSESSMENT', id: assessment.id }.
```

These are integration-glue. No need for in-memory tests; covered by E2E in Phase 12.

- [ ] Implement both adapters reading the actual signatures of `CreateInvoice` and `GenerateAssessments`
- [ ] Commit: `feat(decisions): add charge adapters for billing and petty-cash`

---

## Phase 6 — Supabase repositories (integration tests against real DB)

### Task 29: SupabaseDecisionRepository

**Files:**
- Create: `src/modules/decisions/infrastructure/repositories/SupabaseDecisionRepository.ts`
- Test: `tests/modules/decisions/infrastructure/SupabaseDecisionRepository.test.ts`

Use the project's existing Supabase client (`@/infrastructure/supabase`). Map between rows and `Decision` instances. Implement all methods including `acquireFinalizeLock` (use `supabase.rpc('pg_advisory_xact_lock', { key: hashtext('decision-finalize:' || id) })`).

If `pg_advisory_xact_lock` is not exposed via RPC, create a wrapper SQL function in a small additional migration (see Task 29a if needed — implementer judges based on Supabase version).

- [ ] Tests against local Supabase: create + findById, update status, list with filters and pagination, RLS smoke (anon can't see)
- [ ] Commit: `feat(decisions): add SupabaseDecisionRepository`

---

### Task 30: SupabaseQuoteRepository

Similar layout. Tests for create, findById, listForDecision (filtering by `deleted_at IS NULL`), update for soft delete.

- [ ] Commit: `feat(decisions): add SupabaseQuoteRepository`

---

### Task 31: SupabaseVoteRepository

Tests:
- create unique works, second insert fails with code translated to `VOTE_ALREADY_CAST`
- listForDecision filters by round
- countByQuote returns correct counts

When mapping `apartment_id` for DTO, join `units` to get `apartment_label` (e.g., `units.code` or `units.name` — confirm column from `units` table).

- [ ] Commit: `feat(decisions): add SupabaseVoteRepository`

---

### Task 32: SupabaseAuditLogRepository

Trivial. record() inserts; listForDecision() selects ordered by created_at desc.

- [ ] Commit: `feat(decisions): add SupabaseAuditLogRepository`

---

## Phase 7 — Storage service

### Task 33: DecisionFileStorageService

**Files:**
- Create: `src/modules/decisions/infrastructure/services/DecisionFileStorageService.ts`
- Test: `tests/modules/decisions/infrastructure/DecisionFileStorageService.test.ts`

Methods:
- `uploadQuoteFile(decisionId: string, quoteId: string, file: { name: string; bytes: Uint8Array; mime: string }): Promise<{ file_path: string }>` — uploads to `decisions/{decisionId}/quotes/{quoteId}/{sanitized_name}` in `issue-files` bucket via service role.
- `uploadIssuePhoto(decisionId: string, file)` — analogous, path `decisions/{decisionId}/issue/{name}`.
- `getSignedUrl(file_path: string, ttlSeconds = 600): Promise<string>`.

Validate MIME (`application/pdf`, `image/jpeg`, `image/png`, `image/webp`) and max size (5MB) — throw `QUOTE_INVALID_MIME` / `QUOTE_FILE_TOO_LARGE`.

Pattern to mirror: see how `payment proofs` are uploaded today (likely under `src/modules/payments/infrastructure/services/`).

- [ ] Implement + integration test (upload + signed URL roundtrip)
- [ ] Commit: `feat(decisions): add DecisionFileStorageService`

---

## Phase 8 — TypeBox schemas

### Task 34: HTTP schemas

**Files:**
- Create: `src/modules/decisions/presentation/schemas.ts`

Export TypeBox schemas matching the DTO shapes from spec §6.4:
`DecisionSchema`, `QuoteSchema`, `VoteSchema`, `AuditEntrySchema`, `TallyResponseSchema`, `PaginationMetadataSchema`, `PaginatedDecisionSchema`. Match the project pattern used in `payments/presentation/routes.ts` lines 50-130 (use `t.Object`, `t.Optional`, `t.Union([..., t.Null()])` for nullable).

- [ ] Commit: `feat(decisions): add TypeBox schemas`

---

## Phase 9 — Admin routes

### Task 35: Admin decision routes (Web Admin / Board)

**Files:**
- Create: `src/modules/decisions/presentation/routes.ts`

Export `decisionRoutes` Elysia plugin with the factory pattern. All routes require `admin` or `board` per existing `requireRole` guard already applied at `adminRoutes` group level. Apply `requireBuildingAccess(building_id)` per route where the body/params carry it.

Endpoints (paths within plugin — final path is `/api/v1/admin/decisions/...`):

- `POST /decisions` — create (body validated by schema)
- `POST /decisions/:id/photo` — multipart photo upload, replaces `photo_url` on the row
- `GET /decisions` — list paginated
- `GET /decisions/:id` — detail
- `PATCH /decisions/:id/deadlines` — extend
- `POST /decisions/:id/cancel` — cancel
- `POST /decisions/:id/finalize` — finalize
- `POST /decisions/:id/resolve-tiebreak` — manual resolution
- `POST /decisions/:id/generate-charge` — emit invoice or assessment
- `POST /decisions/:id/quotes` — multipart quote upload
- `GET /decisions/:id/quotes` — list quotes (admin can pass `?include_deleted=true`)
- `DELETE /decisions/:id/quotes/:quoteId` — soft delete
- `GET /decisions/:id/votes` — list votes
- `GET /decisions/:id/results` — tally/results
- `GET /decisions/:id/audit-log` — audit trail
- `POST /decisions/:id/votes` — included for board users who are also residents (mirror APK)

Wire each handler to its use case. Build use case instances at module load time via a thin DI factory.

- [ ] Test handlers wired (invoke real use cases with InMemoryDecisionRepo via DI? Or save for E2E.) Recommended: E2E only.
- [ ] Commit: `feat(decisions): add admin routes for decisions module`

---

## Phase 10 — APK routes

### Task 36: APK decision routes (residents)

**Files:**
- Create: `src/modules/decisions/presentation/app-routes.ts`

Same factory pattern but with different Swagger tag. Limited subset:
- `GET /decisions` — list scoped to user's building(s) via RLS
- `GET /decisions/:id` — detail
- `POST /decisions/:id/quotes` — residents upload (validate `uploader_unit_id` belongs to caller via `profile_units`)
- `DELETE /decisions/:id/quotes/:quoteId` — self-delete in RECEPTION
- `POST /decisions/:id/votes` — cast vote (validate `apartment_id` belongs to caller)
- `GET /decisions/:id/votes` — list (public)
- `GET /decisions/:id/results` — results

Per spec §6 selection 15a=B (board can also create from APK), board users may also POST `/decisions` from this route group — but the APK group itself should only contain endpoints for residents and shared. Keep create on admin side; board uses admin route via Web. Confirmed final scope: APK get list/detail/quotes/votes/results only.

- [ ] Commit: `feat(decisions): add APK routes for decisions module`

---

## Phase 11 — App wiring

### Task 37: Mount + Swagger tags

**Files:**
- Modify: `src/presentation/admin-routes.ts`
- Modify: `src/presentation/app-routes.ts`
- Modify: `src/app.ts` (add Swagger tags for "Admin - Decisions" and "App - Decisions")

- [ ] **Step 1: Add admin mount**

In `src/presentation/admin-routes.ts`:

```ts
import { decisionRoutes } from '@/modules/decisions/presentation/routes';
// ...
export const adminRoutes = new Elysia({ prefix: '/api/v1/admin' })
    .use(requireRole([UserRole.ADMIN, UserRole.BOARD]))
    // existing .use(...) calls
    .use(decisionRoutes);
```

- [ ] **Step 2: Add app mount**

In `src/presentation/app-routes.ts`:

```ts
import { decisionAppRoutes } from '@/modules/decisions/presentation/app-routes';
// ...
export const appRoutes = new Elysia({ prefix: '/api/v1/app' })
    // existing .use(...) calls
    .use(decisionAppRoutes);
```

- [ ] **Step 3: Add Swagger tags**

In `src/app.ts`, add:
```ts
{ name: 'Admin - Decisions', description: 'Decisions / Presupuestos — Web Admin (Board + Admin)' },
{ name: 'App - Decisions', description: 'Decisions / Presupuestos — APK (Residents)' },
```

- [ ] **Step 4: Smoke run**

Run: `bun run dev` then visit `/swagger`
Expected: new endpoints appear under the two tags.

- [ ] **Step 5: Commit**

```sh
git add src/presentation/admin-routes.ts src/presentation/app-routes.ts src/app.ts
git commit -m "feat(decisions): wire admin and APK routes into v1 groups"
```

---

## Phase 12 — E2E tests

### Task 38: Full happy path

**Files:**
- Create: `tests/modules/decisions/e2e/full-happy-path.test.ts`

Scenario:
1. seed: building, units (3 apts), one admin, two residents
2. admin POST `/api/v1/admin/decisions` with reception/voting deadlines in seconds
3. resident1 POST `/api/v1/app/decisions/:id/quotes` — quote A
4. resident2 POST same — quote B
5. wait for reception deadline (or manipulate via direct DB update of the deadline to past)
6. admin POST `/api/v1/admin/decisions/:id/finalize` → outcome `ADVANCED_TO_VOTING`
7. resident1 POST `/api/v1/app/decisions/:id/votes` for quote A
8. resident2 POST same for quote B
9. another resident3 (with profile_units to apt3) POST for quote A
10. update voting deadline to past
11. admin POST finalize → outcome `RESOLVED`, winner = quote A
12. admin POST `/api/v1/admin/decisions/:id/generate-charge` { type: 'ASSESSMENT' }
13. assert `petty_cash_assessment` was created, decision.resulting_id set

- [ ] Commit: `test(decisions): add full happy path E2E`

---

### Task 39: Tiebreak manual flow

**Files:**
- Create: `tests/modules/decisions/e2e/tiebreak-manual.test.ts`

Scenario where round 1 ties (1 vote each for q1 and q2) → finalize triggers round 2 → round 2 also ties → status TIEBREAK_PENDING → admin POST resolve-tiebreak with q1 → RESOLVED.

- [ ] Commit: `test(decisions): add tiebreak manual E2E`

---

### Task 40: Cancel mid-voting

**Files:**
- Create: `tests/modules/decisions/e2e/cancel-mid-voting.test.ts`

Create → quotes → advance → some votes → admin POST cancel → state CANCELLED, votes/quotes still queryable.

- [ ] Commit: `test(decisions): add cancel mid-voting E2E`

---

### Task 41: Deadline extension

**Files:**
- Create: `tests/modules/decisions/e2e/deadline-extension.test.ts`

Create → PATCH deadlines (valid) → audit log shows DEADLINE_EXTENDED with payload.

- [ ] Commit: `test(decisions): add deadline extension E2E`

---

### Task 42: No-votes path

**Files:**
- Create: `tests/modules/decisions/e2e/no-votes.test.ts`

Create → quotes → advance → NO votes → set voting_deadline past → finalize → status TIEBREAK_PENDING with audit reason `NO_VOTES_CAST` → admin cancels.

- [ ] Commit: `test(decisions): add no-votes path E2E`

---

## Phase 13 — Documentation

### Task 43: Update docs/docs.md

**Files:**
- Modify: `docs/docs.md`

Add a new section after the petty-cash section:

```
## 10. Decisions (Presupuestos y Votaciones)

[2-3 paragraphs of overview, then list endpoints with brief descriptions]

### 10.1 Roles
[admin/board/resident table]

### 10.2 Endpoints (Web Admin)
[list]

### 10.3 Endpoints (APK)
[list]

### 10.4 RLS
[reference to migration files]

### 10.5 Storage
Bucket: `issue-files`. ...
```

Also update the header date with new PR number when ready.

- [ ] Commit: `docs(decisions): document decisions module in docs.md`

---

### Task 44: Update spec post-implementation

**Files:**
- Modify: `docs/encuentas.md`

Add a final section "## 14. Implementation Status" with date and PR link, and any deltas observed during implementation (e.g., adapter signature differences, naming tweaks).

- [ ] Commit: `docs(decisions): record implementation deltas in spec`

---

## Self-Review Notes

**Spec coverage:**
- §1 Objetivo + scope V1 → covered by full plan + Task 12 OUT/IN comments
- §2 Reglas de negocio → all covered across use cases (Tasks 12-25)
- §3 State machine → Decision entity (Task 5) + FinalizeDecision (Task 21)
- §4 Modelo de datos → Task 1 (migrations)
- §5 RLS → Tasks 2, 3, 4
- §6 Endpoints + DTOs → Tasks 34, 35, 36
- §7 Edge cases → covered in use cases (CastVote, FinalizeDecision, GenerateCharge)
- §8 Estructura archivos → exactly mirrored
- §9 Testing → Tasks 5-9 (domain), 11-25 (use cases), 29-32 (integration), 38-42 (E2E)
- §10 Migraciones → Tasks 1-4
- §11 Documentación → Task 43
- §12 Scope V1 → reflected in OUT items not having tasks
- §13 Open points → addressed in Task 28 (adapter sigs), Task 33 (storage pattern), Task 4 (bucket via SQL)

**Type consistency check:**
- `DecisionStatus` enum in Decision.ts is reused in CastVote, FinalizeDecision, etc.
- `AuditEvent` enum in DecisionAuditLog.ts referenced consistently
- Use case input naming (`actor_user_id`) consistent across all use cases
- `ChargeResult` type uniform across adapters

**Placeholder scan:** none of the "TBD/TODO" patterns are present in the per-task code. The "compressed" tasks 13-25 use the explicit pattern "implement same way as Task X" where the code skeleton is shown — implementer should write tests and code following the rhythm.

**No spec gaps detected.**

---

## Implementation Reminder

The compressed tasks (13-25, 29-32) intentionally show a code sketch and a commit message. The actual TDD steps (write tests, verify failure, implement, verify pass, commit) are mandatory for every task — this is the project convention shown in tasks 5 and 6. Don't skip the failing-test step.

For Task 28 (adapters) the implementer MUST read the existing `billing/CreateInvoice` and `petty-cash/GenerateAssessments` use case signatures before writing the adapter — they were not duplicated here to avoid drift if those modules change before this work lands.
