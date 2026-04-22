# Decisiones — Módulo de Presupuestos y Votaciones

> **Spec de diseño**. Fecha: 2026-04-22. Estado: aprobado, listo para implementación.
> **Nota nominal**: el archivo histórico se llama `encuentas.md` pero el módulo se nombra `decisions`. El nombre "encuestas" queda deprecado dentro de este documento — refiere al módulo genérico de votaciones/decisiones del condominio, acotado en V1 al flujo de presupuestos competitivos.

---

## 1. Objetivo

Permitir a la junta de condominio resolver **decisiones sobre gastos extraordinarios** (reparaciones, mejoras, servicios) mediante un flujo competitivo de presupuestos con votación democrática: 1 voto por apartamento, mayoría simple, resultado vinculante operativamente.

### 1.1 Alcance V1

- Flujo único: `Decision` → `Quote(s)` → `Vote(s)` → `Resolved` → `Charge` (invoice o assessment).
- Sin abstracción genérica para sondeos, elecciones de junta u otras encuestas. Esos módulos, si llegan, vivirán como hermanos — no como refactor de éste (YAGNI confirmado en levantamiento).
- Sin notificaciones (push/email) en V1.
- Moneda única implícita (alineado con convención actual del proyecto; multi-moneda es proyecto system-wide posterior).

### 1.2 Actores

- **Admin** (`profiles.app_role='admin'`) — acceso total a todos los buildings.
- **Board** — entry en `building_members(role='board')` del building — crea decisions, modera quotes, finaliza, genera cargo.
- **Resident** — tiene `profile_units` con unit del building — sube quotes, vota.

Un usuario puede ser board + resident simultáneamente (modelo Phase 2 del proyecto).

---

## 2. Reglas de negocio — resumen

| Tema | Regla |
|---|---|
| Crear decision | admin + board (scoped al building) |
| Subir quote | admin + board + resident del building, solo en `RECEPTION` |
| Editar quote | **no permitido**; si te equivocaste, soft-delete + re-upload |
| Borrar quote (uploader) | solo en `RECEPTION`, sin reason obligatoria |
| Borrar quote (admin/board) | cualquier fase, con `reason` obligatoria |
| Votar | resident con `profile_units(unit_id=apartment_id)`; admin/board votan si también son residents |
| Unicidad de voto | 1 voto por `(decision, round, apartment_id)`; **primer voto consume** el voto del apto (otros residents del mismo apto no pueden cambiar) |
| Voto en tiebreak round 2 | solo sobre los quotes empatados de round 1 |
| Transparencia | quotes visibles a todos en todas las fases; tally en vivo durante `VOTING`; voto público (se ve quién votó qué) |
| Deadlines | extendibles por admin/board con `reason` obligatoria + audit log |
| Cancelación | admin/board cualquier fase pre-terminal, con `reason`; quotes/votos se archivan |
| Finalización | **explícita** (endpoint llamado por admin/board); sin cron, sin auto-trigger (ver 7.15) |
| Mayoría | simple sobre votos emitidos (sin quórum mínimo) |
| Empate round 1 | apertura automática de round 2 con quotes empatados, duración default 48h (override-able al crear) |
| Empate round 2 | estado `TIEBREAK_PENDING` — admin/board resuelven manual |
| Sin votos o sin quotes activos al cerrar | estado `TIEBREAK_PENDING` con audit `reason=NO_VOTES_CAST` o `NO_ACTIVE_QUOTES` — admin resuelve manual o cancela |
| Post-ganador | admin/board ejecuta `generate-charge`: crea `INVOICE` de billing o `ASSESSMENT` de petty-cash a partir del winner; idempotente (1 sola vez) |
| Re-apertura | no existe. Si el proveedor cae, se crea decision nuevo (admin puede usar "duplicar" como atajo, fuera de V1) |
| Archivos | 1 foto opcional en decision; 1 file obligatorio por quote (PDF/imagen, max 5MB) |

---

## 3. State machine

```
            create()
               │
               ▼
         ┌──────────┐  extend()
    ┌────│ RECEPTION│───────────► RECEPTION (loop)
    │    └────┬─────┘
    │         │ reception_deadline passed + finalize()
    │         ▼
    │    ┌────────┐  extend()
    │ ┌──│ VOTING │────────────► VOTING (loop)
    │ │  └────┬───┘
    │ │       │ voting_deadline passed + finalize()
    │ │       │
    │ │       ├── no tie ──────────────────► ┌──────────┐
    │ │       │                              │ RESOLVED │ (terminal)
    │ │       │                              └──────────┘
    │ │       │
    │ │       ├── tie round 1 ──► auto: round++, status=VOTING
    │ │       │
    │ │       ├── tie round 2 ──► TIEBREAK_PENDING
    │ │       │                      │ admin resolve-tiebreak
    │ │       │                      ▼
    │ │       │                   RESOLVED
    │ │       │
    │ │       └── no votes / no active quotes ──► TIEBREAK_PENDING (manual)
    │ │
    │ └─ cancel() cualquier fase pre-terminal ─► CANCELLED (terminal)
    │
    └──────────────────────────────────────────────►
```

Estados:
- `RECEPTION` — ventana de carga de quotes
- `VOTING` — ventana de votación (puede ser round 1 o 2)
- `TIEBREAK_PENDING` — requiere resolución manual de admin/board
- `RESOLVED` — terminal, ganador declarado
- `CANCELLED` — terminal, abortado

---

## 4. Modelo de datos

### 4.1 Tabla `decisions`

```sql
CREATE TABLE decisions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id              uuid NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  created_by               uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  title                    text NOT NULL CHECK (char_length(title) BETWEEN 5 AND 200),
  description              text,
  photo_url                text,
  status                   text NOT NULL DEFAULT 'RECEPTION'
                             CHECK (status IN ('RECEPTION','VOTING','TIEBREAK_PENDING','RESOLVED','CANCELLED')),
  current_round            smallint NOT NULL DEFAULT 1 CHECK (current_round >= 1),
  reception_deadline       timestamptz NOT NULL,
  voting_deadline          timestamptz NOT NULL,
  tiebreak_duration_hours  integer NOT NULL DEFAULT 48 CHECK (tiebreak_duration_hours BETWEEN 1 AND 720),
  winner_quote_id          uuid REFERENCES decision_quotes(id) ON DELETE SET NULL,
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

CREATE INDEX idx_decisions_building_status ON decisions(building_id, status);
CREATE INDEX idx_decisions_pending_finalize
  ON decisions(status) WHERE status IN ('RECEPTION','VOTING');
```

### 4.2 Tabla `decision_quotes`

```sql
CREATE TABLE decision_quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id        uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  uploader_user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  uploader_unit_id   uuid REFERENCES units(id) ON DELETE SET NULL,
  provider_name      text NOT NULL CHECK (char_length(provider_name) BETWEEN 2 AND 200),
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  notes              text,
  file_url           text NOT NULL,
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason    text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CHECK (deleted_at IS NULL OR deletion_reason IS NOT NULL)
);

CREATE INDEX idx_decision_quotes_active
  ON decision_quotes(decision_id) WHERE deleted_at IS NULL;
```

### 4.3 Tabla `decision_votes`

```sql
CREATE TABLE decision_votes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id        uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  round              smallint NOT NULL CHECK (round >= 1),
  apartment_id       uuid NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
  quote_id           uuid NOT NULL REFERENCES decision_quotes(id) ON DELETE RESTRICT,
  voted_by_user_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (decision_id, round, apartment_id)
);

CREATE INDEX idx_decision_votes_tally ON decision_votes(decision_id, round, quote_id);
```

### 4.4 Tabla `decision_audit_log`

```sql
CREATE TABLE decision_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id      uuid NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  event            text NOT NULL
                     CHECK (event IN ('CREATED','DEADLINE_EXTENDED','CANCELLED',
                                      'QUOTE_DELETED','FINALIZED','TIEBREAK_OPENED',
                                      'WINNER_SET_MANUAL','CHARGE_GENERATED','PHASE_ADVANCED')),
  actor_user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_decision_audit_decision ON decision_audit_log(decision_id, created_at DESC);
```

---

## 5. RLS (Row Level Security)

### 5.1 Helper SQL nuevo

```sql
CREATE OR REPLACE FUNCTION get_my_building_ids_as_resident()
  RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(array_agg(DISTINCT u.building_id), ARRAY[]::uuid[])
  FROM profile_units pu
  JOIN units u ON u.id = pu.unit_id
  WHERE pu.profile_id = auth.uid();
$$;
```

Reutiliza `get_my_role()` y `get_my_building_ids_as_board()` existentes.

### 5.2 Policies por tabla

Detalle en Sección 3 del levantamiento. Resumen:

| Tabla | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `decisions` | admin + board + resident del building | admin + board | admin + board | nadie (cancel es UPDATE) |
| `decision_quotes` | admin + board + resident del building (transparencia total) | admin + board + resident del building, solo en `RECEPTION` | admin + board (cualquier fase) / uploader (solo `RECEPTION`) | nadie (soft delete) |
| `decision_votes` | admin + board + resident del building (voto público) | user con `profile_units(unit_id=apartment_id)`, en `VOTING`, round coincide | nadie | nadie |
| `decision_audit_log` | admin + board (residents NO) | admin + board (actor_user_id = auth.uid()) | nadie | nadie |

Validaciones finas (status, round correcto, reason obligatorio) viven en use cases. RLS es defensa de primera línea.

### 5.3 Storage bucket `issue-files`

Bucket privado. Path schema:
- `decisions/{decision_id}/issue/{filename}` — foto del decision
- `decisions/{decision_id}/quotes/{quote_id}/{filename}` — file del quote

SELECT policy: miembros del building del decision (admin, board, resident). INSERT/UPDATE: solo service role desde backend (frontend nunca sube directo; backend firma y sube). Signed URLs de lectura con TTL corto (5-10 min), re-firma por request.

---

## 6. Flujos y endpoints HTTP

### 6.1 Doble mount

- `/api/v1/decisions/...` — Web Admin (admin + board)
- `/api/v1/app/decisions/...` — APK (residents + admin/board con units)

Misma implementación, factory `createDecisionRoutes(tag)` para evitar duplicados en Swagger. Patrón replicado de `buildingPublicRoutes`.

### 6.2 Paginación

Todos los endpoints de listado siguen el estándar PR #33:
- Query: `?page=<n>&limit=<n|all>`
- Defaults: `page=1`, `limit=20`
- Cap numérico: 100 (silent clamp)
- Response: `{ data: [...], metadata: { total, page, limit, totalPages, hasNextPage, hasPrevPage } }`

### 6.3 Catálogo de endpoints

| # | Método + Path | Actor | Descripción |
|---|---|---|---|
| 1 | `POST /decisions` | admin, board | Crear decision |
| 2 | `POST /decisions/:id/photo` | admin, board | Subir/reemplazar foto (multipart) |
| 3 | `GET /decisions` | cualquiera | Listar decisions con filtros y paginación |
| 4 | `GET /decisions/:id` | cualquiera con acceso building | Detalle + quotes + my_vote + tally |
| 5 | `PATCH /decisions/:id/deadlines` | admin, board | Extender deadlines con reason |
| 6 | `POST /decisions/:id/cancel` | admin, board | Cancelar con reason |
| 7 | `POST /decisions/:id/finalize` | admin, board | Avanzar fase o cerrar ronda |
| 8 | `POST /decisions/:id/resolve-tiebreak` | admin, board | Resolver empate manual (round 2+ o no-votes) |
| 9 | `POST /decisions/:id/generate-charge` | admin, board | Emitir invoice o assessment desde winner |
| 10 | `POST /decisions/:id/quotes` | admin, board, resident | Subir quote (multipart) |
| 11 | `GET /decisions/:id/quotes` | cualquiera con acceso | Listar quotes |
| 12 | `DELETE /decisions/:id/quotes/:quoteId` | uploader (en RECEPTION) o admin/board (cualquier fase, con reason) | Soft delete |
| 13 | `POST /decisions/:id/votes` | resident (APK) | Emitir voto |
| 14 | `GET /decisions/:id/votes` | cualquiera con acceso | Listar votos (público) |
| 15 | `GET /decisions/:id/results` | cualquiera con acceso | Tally en vivo durante VOTING, final en RESOLVED |
| 16 | `GET /decisions/:id/audit-log` | admin, board | Auditoría completa |

### 6.4 DTOs

```ts
interface DecisionDTO {
  id: string;
  building_id: string;
  title: string;
  description: string | null;
  photo_url: string | null;
  status: 'RECEPTION' | 'VOTING' | 'TIEBREAK_PENDING' | 'RESOLVED' | 'CANCELLED';
  current_round: number;
  reception_deadline: string;      // ISO-8601
  voting_deadline: string;
  tiebreak_duration_hours: number;
  winner_quote_id: string | null;
  resulting_type: 'INVOICE' | 'ASSESSMENT' | null;
  resulting_id: string | null;
  finalized_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_by: { id: string; name: string };
  created_at: string;
  updated_at: string;
  is_deadline_passed: boolean;     // computado para UI (pending finalize)
  quote_count: number;             // activos (no deleted)
}

interface QuoteDTO {
  id: string;
  decision_id: string;
  uploader: { id: string; name: string };
  uploader_unit_id: string | null;
  provider_name: string;
  amount: number;
  notes: string | null;
  file_url: string;                // signed URL, TTL 5-10 min
  deleted_at: string | null;
  deleted_by: { id: string; name: string } | null;
  deletion_reason: string | null;
  created_at: string;
}

interface VoteDTO {
  id: string;
  decision_id: string;
  round: number;
  apartment_id: string;
  apartment_label: string;         // "Apto 4B", join units
  quote_id: string;
  voted_by: { id: string; name: string };
  created_at: string;
}

interface TallyDTO {
  round: number;
  status: DecisionStatus;
  total_apartments: number;        // units del building
  total_votes: number;
  participation_pct: number;
  tallies: Array<{
    quote_id: string;
    provider_name: string;
    amount: number;
    votes: number;
    pct: number;
  }>;
  winner_quote_id: string | null;
  is_tied: boolean;
}

interface AuditEntryDTO {
  id: string;
  decision_id: string;
  event: string;
  actor: { id: string; name: string };
  payload: Record<string, unknown>;
  created_at: string;
}
```

### 6.5 Reglas por flow

**`FinalizeDecision`** — atómico, envuelto en transacción con advisory lock `pg_advisory_xact_lock(hashtext('decision-finalize:' || id))` para evitar race entre admin+board simultáneos. Idempotente: si ya `finalized_at` para la fase actual, retorna estado actual sin mutar. Solo admin/board pueden invocarlo (ver 7.14).

**`CastVote`** — validaciones en use case:
- `profile_units(profile_id=auth.uid(), unit_id=apartment_id)` existe
- `apartment_id` pertenece a `decision.building_id`
- `status='VOTING'` y `voting_deadline > now()`
- `quote.decision_id = decision_id`, `quote.deleted_at IS NULL`
- Si `current_round > 1`: `quote_id` pertenece al set de quotes empatados del round anterior
- UNIQUE constraint lanza 409 en duplicado

**`GenerateCharge`** — idempotente via `resulting_id IS NULL`. Invoca:
- `type='INVOICE'` → `billing.CreateInvoice({ building_id, amount: override ?? winner.amount, type: 'EXTRAORDINARY', description: title, ... })`
- `type='ASSESSMENT'` → `petty-cash.GenerateAssessments({ building_id, amount, description, category })`

Trazabilidad bidireccional opcional (V1.5): columna `source_decision_id` en `invoices` y `petty_cash_assessments`.

**`DeleteQuote`** — branching en use case:
- Si `uploader_user_id = auth.uid()` y `status='RECEPTION'` → permite sin reason, marca `deletion_reason='self-deleted by uploader'`
- Si requester es admin/board → exige `reason`, permite cualquier fase
- Otro caso → 403

---

## 7. Edge cases y error handling

### 7.1 Race en finalize
Advisory lock en Postgres + re-validación post-lock. Segundo caller recibe estado consistente.

### 7.2 Voto a quote borrado
Use case rechaza con `422 QUOTE_DELETED`. FK permite la inserción pero validación previa bloquea.

### 7.3 Voto en round 2 para quote NO empatado
Use case rechaza con `422 QUOTE_NOT_IN_TIEBREAK`.

### 7.4 VOTING cierra con cero votos
`finalize` detecta `total_votes=0` → `status='TIEBREAK_PENDING'` + audit `payload={ reason: 'NO_VOTES_CAST' }`. Admin usa `resolve-tiebreak` (permite cualquier quote activo) o `cancel`.

### 7.5 VOTING cierra con cero quotes activos
Si todos los quotes fueron borrados. `finalize` detecta → `status='TIEBREAK_PENDING'` + `payload={ reason: 'NO_ACTIVE_QUOTES' }`. Admin `cancel` típicamente (no hay nada que elegir).

### 7.6 Finalize entrando a VOTING sin quotes activos
`finalize` desde `RECEPTION` con cero quotes activos → `422 DECISION_NO_ACTIVE_QUOTES`. Admin debe extender deadline o cancelar.

### 7.7 Upload quote con file corrupto / falla
Orden: subir file a `quotes/pending/{uuid}`, luego INSERT con `file_url=final_path`. Si INSERT falla, cron o cleanup task borra `pending/*` con `created_at > 1h`. (Replica patrón de payment proofs del proyecto — revisar implementación existente.)

### 7.8 Signed URL expira
Backend re-firma en cada GET del DTO. Frontend no cachea `file_url`.

### 7.9 Generate-charge doble
Use case bloquea con `409 DECISION_ALREADY_CHARGED`. Para re-emitir requiere flow manual (fuera de V1): cancelar el invoice/assessment y endpoint admin que nullea `resulting_id`.

### 7.10 FKs y cascadas
- `decisions.building_id` → `RESTRICT` (no se borra building con decisions vivas)
- `decisions.created_by`, `uploader_user_id`, `voted_by_user_id`, `deleted_by`, `actor_user_id` → `SET NULL` (audit sobrevive a eliminación de usuario)
- `decision_quotes.decision_id` → `CASCADE`
- `decision_votes.quote_id` → `RESTRICT` (soft-delete de quote no propaga; vote queda válido)
- `decision_votes.apartment_id` → `RESTRICT`

### 7.11 Deadline extension inválida
- nueva deadline `< now()` → `400`
- `voting_deadline < reception_deadline` → `400`
- extender `reception_deadline` cuando `status='VOTING'` → `422 DECISION_WRONG_STATUS`

### 7.12 Resident pierde profile_units post-voto
Voto queda válido (snapshot al momento). DTO muestra datos actuales del user (su nombre sigue), vote se cuenta normalmente.

### 7.13 File upload validaciones
- MIME permitidos: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`
- Max size: 5MB (config `DECISION_QUOTE_MAX_BYTES`)
- Filename sanitizado antes de construir path
- Errores: `400 QUOTE_INVALID_MIME`, `400 QUOTE_FILE_TOO_LARGE`

### 7.14 Finalize auto-trigger (descartado en V1)

Originalmente se consideró auto-disparar `finalize` en el primer `GET /decisions/:id` post-deadline, con advisory lock para evitar race. **Descartado en V1** por conflicto con RLS de `decision_audit_log` (un resident haciendo el primer read no tiene permiso de INSERT en audit). Refactor posible en V2 si se introduce un "system user" o se escribe audit via service role. Por ahora, admin/board disparan `POST /decisions/:id/finalize` explícitamente. El DTO expone `is_deadline_passed: true` para que la UI muestre banner "pending finalize".

### 7.15 Catálogo de error codes

```
400: DECISION_INVALID_DEADLINES, DECISION_INVALID_PHOTO,
     QUOTE_INVALID_MIME, QUOTE_FILE_TOO_LARGE, QUOTE_INVALID_AMOUNT
401: UNAUTHORIZED
403: DECISION_FORBIDDEN_BUILDING, DECISION_FORBIDDEN_ROLE
404: DECISION_NOT_FOUND, QUOTE_NOT_FOUND
409: DECISION_ALREADY_FINALIZED, VOTE_ALREADY_CAST, DECISION_ALREADY_CHARGED
422: DECISION_DEADLINE_NOT_YET_PASSED, DECISION_NO_ACTIVE_QUOTES,
     QUOTE_DELETED, QUOTE_NOT_IN_TIEBREAK, VOTE_BUILDING_MISMATCH,
     VOTE_UNIT_NOT_OWNED, DECISION_WRONG_STATUS, TIEBREAK_MANUAL_NOT_ALLOWED
```

---

## 8. Estructura de archivos

```
src/modules/decisions/
├── domain/
│   ├── entities/
│   │   ├── Decision.ts
│   │   ├── Decision.test.ts
│   │   ├── DecisionQuote.ts
│   │   ├── DecisionQuote.test.ts
│   │   ├── DecisionVote.ts
│   │   └── DecisionAuditLog.ts
│   ├── services/
│   │   ├── TallyService.ts             # pure fn: votes[] → { tallies, tied[], winner }
│   │   └── TallyService.test.ts
│   └── repository.ts                   # interfaces de repos
├── application/
│   ├── ports/
│   │   └── ChargeGenerator.ts          # interface adapter billing/petty-cash
│   └── use-cases/
│       ├── CreateDecision.ts
│       ├── ListDecisions.ts
│       ├── GetDecision.ts
│       ├── ExtendDeadlines.ts
│       ├── CancelDecision.ts
│       ├── FinalizeDecision.ts
│       ├── ResolveTiebreak.ts
│       ├── GenerateCharge.ts
│       ├── UploadQuote.ts
│       ├── ListQuotes.ts
│       ├── DeleteQuote.ts
│       ├── CastVote.ts
│       ├── ListVotes.ts
│       ├── GetResults.ts
│       ├── GetAuditLog.ts
│       └── *.test.ts                   # uno por use case
├── infrastructure/
│   ├── repositories/
│   │   ├── SupabaseDecisionRepository.ts
│   │   ├── SupabaseQuoteRepository.ts
│   │   ├── SupabaseVoteRepository.ts
│   │   └── SupabaseAuditLogRepository.ts
│   ├── services/
│   │   └── DecisionFileStorageService.ts
│   └── adapters/
│       ├── InvoiceChargeAdapter.ts
│       └── AssessmentChargeAdapter.ts
└── presentation/
    ├── routes.ts                       # /api/v1/decisions
    ├── app-routes.ts                   # /api/v1/app/decisions
    └── schemas.ts                      # TypeBox DTOs

supabase/migrations/
├── 20260423000000_create_decisions.sql
├── 20260423000100_decisions_helper_functions.sql
├── 20260423000200_decisions_rls.sql
└── 20260423000300_create_issue_files_bucket.sql
```

### 8.1 Mount points

- `src/index.ts` (o donde estén las root routes): registrar `decisionRoutes` bajo `/api/v1`
- `src/modules/app.ts` (o equivalente que arma `/api/v1/app`): montar `decisionAppRoutes`

---

## 9. Testing

### 9.1 Nivel 1 — Domain unit tests (pure)

```
Decision.test.ts
  - Rechaza deadlines invertidas
  - advanceToVoting() solo si RECEPTION + reception_deadline < now
  - resolve(quote_id) solo en VOTING o TIEBREAK_PENDING
  - openTiebreak() incrementa round y extiende voting_deadline
  - cancel(reason) rechaza en terminales

DecisionQuote.test.ts
  - softDelete() idempotente (no re-delete)
  - validate amount > 0
  - validate file_url no vacío

DecisionVote.test.ts
  - apartment_id pertenece al building
  - round obligatorio

TallyService.test.ts
  - zero votes → { is_tied: true, reason: 'NO_VOTES' }
  - un winner claro
  - empate 2-way / 3-way
  - round 2 filtra votos de round 1
```

### 9.2 Nivel 2 — Use cases (repos in-memory)

```
CreateDecision: happy + bad deadlines + no building access
CastVote: happy, 409 duplicado, 422 unit no propia, 422 wrong status, 422 quote no empatado en round 2
FinalizeDecision: RECEPTION→VOTING, VOTING→RESOLVED, tiebreak round 2, TIEBREAK_PENDING, no-votes edge, no-active-quotes edge, idempotencia
GenerateCharge: INVOICE ok, ASSESSMENT ok, 409 double call
DeleteQuote: uploader RECEPTION ok, uploader VOTING rechaza, admin+reason ok, admin sin reason 400
ResolveTiebreak: rechaza en round=1, acepta en TIEBREAK_PENDING
ExtendDeadlines: reception en VOTING rechaza, voting ok
CancelDecision: RESOLVED/CANCELLED rechaza, fases activas ok
```

### 9.3 Nivel 3 — Integration (Supabase real o Docker)

```
- UNIQUE (decision_id, round, apartment_id) fuerza 409
- RLS: resident de building A no ve decisions de B
- RLS: residents NO ven audit_log
- Soft delete no aparece en SELECT default
- FK RESTRICT bloquea delete de building con decisions vivas
- Signed URL se re-firma al expirar
```

### 9.4 Nivel 4 — E2E HTTP

```
flow.full-happy-path.test.ts        # create → 2 quotes → advance → 2 votes → finalize → assessment
flow.tiebreak-manual.test.ts        # round 1 tie → round 2 tie → resolve-tiebreak
flow.cancel-mid-voting.test.ts
flow.deadline-extension.test.ts
flow.no-votes-path.test.ts          # nadie vota → TIEBREAK_PENDING → cancel
```

### 9.5 Coverage targets

- Domain entities: **>95%**
- Use cases: **>85%**
- Repositories: integration happy path + RLS policies
- HTTP routes: ≥1 E2E por flow crítico

---

## 10. Migraciones (orden)

1. `20260423000000_create_decisions.sql` — 4 tablas, índices, constraints, CHECKs.
   - Nota: FK circular entre `decisions.winner_quote_id → decision_quotes(id)` y `decision_quotes.decision_id → decisions(id)`. Crear `decisions` primero sin la FK a winner, luego `decision_quotes`, luego `ALTER TABLE decisions ADD CONSTRAINT fk_winner_quote FOREIGN KEY (winner_quote_id) REFERENCES decision_quotes(id) ON DELETE SET NULL;`.
2. `20260423000100_decisions_helper_functions.sql` — `get_my_building_ids_as_resident()`.
3. `20260423000200_decisions_rls.sql` — policies + ENABLE ROW LEVEL SECURITY.
4. `20260423000300_create_issue_files_bucket.sql` — bucket `issue-files` + storage policies.

Todas idempotentes (`IF NOT EXISTS`) donde aplique, siguiendo convención del proyecto.

---

## 11. Documentación post-feature

Actualizar `docs/docs.md` con:
- Header con fecha del PR y resumen del cambio.
- Sección nueva "10. Decisions (Presupuestos y Votaciones)" con overview, flujo, endpoints, DTOs, roles, RLS.
- Referencia al bucket `issue-files` en sección de storage.

---

## 12. Scope explícito V1

### IN
- CRUD de decisions, quotes, votes
- Finalize + tiebreak (auto round 2 + manual fallback)
- Generate-charge → `INVOICE` de billing o `ASSESSMENT` de petty-cash
- Audit log
- Storage bucket dedicado `issue-files`
- RLS + guards Elysia
- Tests en los 4 niveles
- Migrations + docs

### OUT (explícito)
- Notificaciones (push / email / in-app bell) — V2
- Conversión multi-moneda — proyecto system-wide aparte
- Re-apertura post-`RESOLVED` — admin clona (o flow "duplicar" en V1.5)
- Voto secreto o anónimo — V1 es transparente
- Abstracción genérica para sondeos / elecciones de junta — módulos hermanos futuros
- Cron automático de transiciones — V1 usa finalize explícito
- Múltiples archivos por quote — 1 file por V1
- Edición de quotes post-upload — V1 es borrar + re-subir
- Trazabilidad bidireccional (`source_decision_id` en invoices/assessments) — V1.5

---

## 13. Open points para writing-plans

- Revisar patrón exacto de upload de files en el proyecto (payment proofs) para replicar two-step consistentemente.
- Confirmar nombre y ubicación del mount del `/api/v1/app` router.
- Decidir si bucket `issue-files` se crea por migration SQL o vía Supabase dashboard/script (el proyecto usa alguna de las dos convenciones).
- Confirmar versión de Bun/Elysia para tipos de multipart (algunas versiones tienen APIs distintas).
