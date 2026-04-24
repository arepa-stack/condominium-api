# Condominio API Server — Documentación Funcional

> **Última actualización**: 2026-04-24 — Refleja el estado post-PR `feat/decisions-early-finalize-signal`. El DTO de tally de decisiones ahora expone `is_early_finalizable` + `early_finalize_reason` (`ALL_VOTED` | `MATHEMATICALLY_DECIDED` | `null`) como señal derivada para habilitar finalizar antes de `voting_deadline`. Ver §12.6.
> **Última actualización**: 2026-04-20 — Refleja el estado post-PR `feat/normalize-pagination`.
> **Paginación uniforme** en los 10 endpoints de listado. Response shape estándar `{ data: [...], metadata: { total, page, limit, total_pages, has_next_page, has_prev_page } }`. Query params estándar: `?page=<1-indexed>&limit=<number|"all">`. Defaults: `page=1`, `limit=20`. Cap numérico `100` (silent clamp); `limit=all` truncado a `10000` (el metadata señaliza truncación via `has_next_page`). Filtros preexistentes intactos. Ver "Paginación estándar" abajo y `docs/petty-cash-client-handoff.md` para el contrato completo. **Breaking** para cualquier cliente que leía `data[]` directo del body — ahora debe desenvolver `response.data`.
> Cambios anteriores (caja chica, roles, auth, payments) siguen vigentes — ver más abajo.
> **Última actualización**: 2026-04-19 — Refleja el estado post-PR Phase 3 (final) del rediseño de Caja Chica (`feat/petty-cash-ledger-phase-3`).
> Cambios destacados de Phase 3: se **dropearon** `petty_cash_transactions`, `petty_cash_fund.current_balance` y `petty_cash_fund.currency`. El entity `PettyCashFund` ahora es solo metadata (`id`, `building_id`, `updated_at`). Balance vive exclusivamente en la vista `petty_cash_balance`. Nuevo endpoint `POST /petty-cash/funds/:buildingId/entries/:entryId/reverse` para emitir counter-asientos manuales sobre cualquier entry — idempotente, append-only, rechaza reversar una reversal. Secciones 4.1/7.5/7.6/7.9 de este doc reescritas al estado final.
> Cambios de Phase 2 vigentes: modelo **ledger-based** (append-only). `petty_cash_entries` reemplaza a `petty_cash_transactions`; el balance se deriva de la vista `petty_cash_balance`. Los **egresos permiten balance negativo** (overdraft): el excedente vive en el ledger como `amount < 0`, sin invoices fantasma PAID building-level. Los **assessments son batches con nombre**: tabla `petty_cash_assessment` + campo `invoices.assessment_id`. El admin llama `POST /petty-cash/funds/:id/assessments` con `{ description, amount, category? }` y se crea 1 invoice PENDING por unit linkeada al batch. **Auto-collection**: cuando un resident paga una invoice PETTY_CASH con unit_id, `ApprovePayment` genera automáticamente una entry `collection` en el ledger; `ReversePayment` genera el counter-asiento. Transparencia desglosada por assessment.
> Cambios de Phase 4 (roles) vigentes: se **dropeó la columna legacy `profiles.role`** y su CHECK constraint. Las 3 RLS policies que la leían directamente (`profile_units`, `payment_allocations`) ahora pasan por `get_my_role()`. La función SQL `get_my_role()` sigue devolviendo `admin|board|resident` (derivado de `app_role` + `building_members`) para que las RLS queden intactas. **Breaking change para clientes**: la respuesta de `/auth/login`, `/auth/register`, `GET /users/*` ya **NO incluye el field `role`** — los clientes deben leer `app_role` + `buildingRoles[]`. El endpoint `PATCH /users/:id` ahora acepta `app_role` (admin-only) en lugar de `role`; para cambios per-edificio seguir usando `POST /users/:id/roles`. El endpoint `POST /users` mantiene el input ergonómico `role: 'admin'|'board'|'resident'` que el backend traduce a `app_role` + `buildingRoles`. `UserProps.role` eliminado del entity; `changeRole()` renombrado a `changeAppRole()`.
> Cambios destacados de Phase 4: se **dropeó la columna legacy `profiles.role`** y su CHECK constraint. Las 3 RLS policies que la leían directamente (`profile_units`, `payment_allocations`) ahora pasan por `get_my_role()`. La función SQL `get_my_role()` sigue devolviendo `admin|board|resident` (derivado de `app_role` + `building_members`) para que las RLS queden intactas. **Breaking change para clientes**: la respuesta de `/auth/login`, `/auth/register`, `GET /users/*` ya **NO incluye el field `role`** — los clientes deben leer `app_role` + `buildingRoles[]`. El endpoint `PATCH /users/:id` ahora acepta `app_role` (admin-only) en lugar de `role`; para cambios per-edificio seguir usando `POST /users/:id/roles`. El endpoint `POST /users` mantiene el input ergonómico `role: 'admin'|'board'|'resident'` que el backend traduce a `app_role` + `buildingRoles`. `UserProps.role` eliminado del entity; `changeRole()` renombrado a `changeAppRole()`.
> Cambios de Phases previas vigentes: `profiles.app_role` es la fuente del rol global (Phase 1-2); `building_members.role` per-edificio con CHECK (Phase 1); scoping de board derivado solo de `building_members` via `getBuildingsWhereBoard()` en todos los use cases, con helper `getAffiliatedBuildings()` para reachability del lado del target (Phase 3). El panel admin gatea entrada con `app_role === 'admin' || buildingRoles.length > 0`.
> Cambios arquitectónicos previos vigentes: paginación en `/admin/billing/invoices` con metadata, módulo **Directory**, vista SQL `board_members_directory`, el dominio es dueño de `invoice.paid_amount` y del status, estado `PARTIAL`, dos canales de credit ledger, endpoints de reverse y petty cash transparency, contrato endurecido en `POST /payments` (proof required, reference/bank por método, date ISO no-futura).

## 1. Visión General

**Condominio** es un sistema backend para una aplicación móvil de gestión de condominios residenciales. Permite a residentes, juntas de condominio y administradores gestionar pagos, facturación, caja chica y la información de edificios y unidades (apartamentos).

### Stack Tecnológico
- **Runtime**: Bun
- **Framework**: ElysiaJS (TypeScript)
- **Base de Datos**: Supabase (PostgreSQL)
- **Almacenamiento**: Supabase Storage (comprobantes de pago y evidencias)
- **Autenticación**: JWT via Supabase Auth
- **Arquitectura**: Clean Architecture (Domain → Application → Infrastructure → Presentation)

---

## 2. Sistema de Roles

### 2.0 Modelo (Phase 2)

El rol de un usuario se **descompone en tres dimensiones independientes**:

| Columna / Tabla | Significado | Valores | Fuente de verdad para |
|---|---|---|---|
| `profiles.app_role` | Capacidad global de sistema | `admin` \| `user` | "¿Es staff de la plataforma?" |
| `building_members.role` | Rol de gobierno en un edificio específico | `board` (CHECK constraint; extensible a futuro) | "¿Es board en el edificio X?" |
| `profile_units` | Relación user ↔ unidad | — (pivot) | "¿Es residente del edificio X?" (se infiere por tener una unidad ahí) |

`profiles.role` existe todavía como columna **legacy** (se dropea en Phase 4). Hoy se sincroniza con `app_role` via dual-write — todo código nuevo debe ignorarla.

Esto permite que un mismo usuario sea, por ejemplo, **residente en edificio A y board en edificio B** simultáneamente — algo imposible con el modelo single-column anterior.

**Derivación del "rol efectivo"** (implementada en el guard `requireRole` y en la función SQL `get_my_role()`):

```
app_role = 'admin'                     → efectivo = 'admin'
cualquier building_members(role=board) → efectivo = 'board'
ninguno de los anteriores              → efectivo = 'resident'
```

La función SQL `get_my_role()` preserva el contrato de retorno `admin|board|resident` para que las RLS policies sigan funcionando sin cambios.

### 2.1 Admin (`app_role = 'admin'`)
- **Descripción**: Administrador general de la plataforma.
- **Alcance**: Acceso total a todos los edificios y todas las operaciones. El guard `requireBuildingAccess` bypassea el chequeo de building membership cuando `app_role = 'admin'`.
- **Permisos**:
  - CRUD completo de edificios y unidades
  - Crear, actualizar y eliminar usuarios
  - Cambiar roles de usuarios
  - Ver y gestionar todos los pagos de todos los edificios
  - Aprobar o rechazar pagos, revertir pagos APPROVED
  - Cargar deuda (facturas/invoices) a unidades
  - Carga masiva de facturas desde Excel
  - Gestionar caja chica (ingresos y egresos)
  - Ver balances y crédito de cualquier unidad
  - Ver recibos unificados (normales + caja chica) con filtro por etiqueta
- **Acceso**: Solo Panel Web Admin. No usa la APK.

### 2.2 Board / Junta (al menos una fila en `building_members` con `role='board'`)
- **Descripción**: Miembro de la junta de condominio de **un edificio específico**. `app_role = 'user'` + entry(ies) en `building_members`.
- **Alcance**: Exclusivamente los edificios donde tiene entry en `building_members`. La lista se carga una sola vez en el guard `requireRole` como `profile.boardBuildingIds[]` y `requireBuildingAccess` la consume desde el context (sin round-trip extra a la DB).
- **Scoping de listados/operaciones** (Phase 3): los use cases derivan la lista de edificios autorizados **únicamente** de `building_members`. Tener una unidad (`profile_units`) en un edificio NO otorga autoridad de Board ahí — sólo marca al user como resident. Esto permite modelar sin leaks el caso "board en A, resident en B": el user lista/aprueba users y payments solo de A.
- **Permisos desde Web Admin** (operaciones administrativas):
  - Aprobar usuarios de su edificio
  - Ver y gestionar usuarios de su edificio
  - Ver todos los pagos de su edificio y aprobar/rechazar
  - Cargar deuda a unidades de su edificio
  - Carga masiva de facturas desde Excel para su edificio
  - Gestionar caja chica de su edificio (registrar ingresos y gastos)
  - Ver recibos unificados (normales + caja chica) con filtro por etiqueta
  - Ver crédito/saldo a favor de unidades de su edificio
- **Acceso**: Panel Web Admin. Un mismo usuario puede también acceder a la APK si tiene `profile_units` en algún edificio (es resident ahí) — los dos roles coexisten.

### 2.3 Resident / Residente (`app_role = 'user'` + sin entries `board` + `profile_units` en el edificio)
- **Descripción**: Residente de una o más unidades. Un user es "resident de edificio X" si tiene al menos una fila en `profile_units` cuya `unit` pertenezca a X.
- **Alcance**: Solo puede operar sobre su propia información y sus unidades asignadas.
- **Permisos**:
  - Ver y editar su propio perfil (nombre, teléfono)
  - Ver historial de pagos de su unidad
  - Registrar (reportar) nuevos pagos con comprobante
  - Ver su estado de solvencia
  - Ver facturas de su propia unidad (con filtro por etiqueta: normales o caja chica)
  - Ver balance de deuda de su propia unidad
  - Ver crédito/saldo a favor de su propia unidad
  - Ver balance e historial de caja chica de su edificio (solo lectura, transparencia)
  - **No puede** registrar ingresos ni gastos de caja chica
  - **No puede** acceder al Panel Web Admin (salvo que además sea board en algún edificio)
- **Acceso**: Aplicación Móvil (APK). Si el usuario también tiene `building_members` en otro edificio, puede entrar al panel admin para ese edificio pero sigue siendo resident en éste.

---

## 3. Estados de Usuario

Cada usuario tiene un estado (`status`) que controla su acceso al sistema:

| Estado | Descripción |
|--------|-------------|
| `pending` | Recién registrado, esperando aprobación de un Admin o Board |
| `active` | Aprobado y con acceso completo según su rol |
| `inactive` | Desactivado, sin acceso |
| `rejected` | Registro rechazado |

### Flujo de Registro
1. Un residente se registra vía `POST /auth/register` con nombre, email, contraseña, edificio y unidad.
2. Su estado inicial es `pending`.
3. Un Admin o Board aprueba al usuario vía `POST /users/:id/approve`.
4. El estado cambia a `active` y el usuario puede operar normalmente.

---

## 4. Modelo de Datos

### 4.1 Entidades Principales

#### Edificio (`buildings`)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `name` | TEXT | Nombre del edificio (ej: "Torre A") |
| `address` | TEXT | Dirección completa |
| `created_at` | TIMESTAMP | Fecha de creación |
| `updated_at` | TIMESTAMP | Última actualización |

#### Unidad (`units`)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `building_id` | UUID | Edificio al que pertenece |
| `name` | TEXT | Nombre/número de la unidad (ej: "4B") |
| `floor` | TEXT | Piso (opcional) |
| `aliquot` | NUMERIC | Alícuota de la unidad (opcional) |

#### Perfil de Usuario (`profiles`)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Mismo ID que `auth.users` de Supabase |
| `email` | TEXT | Correo electrónico |
| `name` | TEXT | Nombre completo |
| `phone` | TEXT | Teléfono (opcional) |
| `app_role` | TEXT | Capacidad global: `admin` \| `user`. CHECK constraint. Index en la columna. |
| `status` | TEXT | Estado: `active`, `pending`, `inactive`, `rejected` |

> **Nota Phase 4**: la columna legacy `role` (con valores `admin`/`board`/`resident`) **fue removida**. Los roles per-edificio viven en `building_members`, y la residencia se infiere de `profile_units`. La función SQL `get_my_role()` sigue exponiendo un resultado `admin|board|resident` derivado, para que las RLS policies que dependen de ese contrato no rompan.

#### Asociación Perfil-Unidad (`profile_units`)
Tabla pivot que permite que un usuario esté asociado a múltiples unidades.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `profile_id` | UUID | ID del usuario |
| `unit_id` | UUID | ID de la unidad |
| `is_primary` | BOOLEAN | Si es la unidad principal del usuario |

#### Membresía de Edificio (`building_members`)
Tabla que gestiona roles de junta por edificio (separada de la relación usuario-unidad).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `profile_id` | UUID | ID del usuario |
| `building_id` | UUID | ID del edificio |
| `role` | TEXT | Rol en ese edificio (ej: `board`) |

#### Pago (`payments`)
| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `user_id` | UUID | Usuario que reportó el pago |
| `unit_id` | UUID | Unidad a la que aplica el pago |
| `building_id` | UUID | Edificio al que pertenece |
| `amount` | NUMERIC | Monto del pago |
| `payment_date` | DATE | Fecha del pago |
| `method` | TEXT | Método: `PAGO_MOVIL`, `TRANSFER`, `CASH` |
| `reference` | TEXT | Número de referencia (opcional) |
| `bank` | TEXT | Banco emisor (opcional) |
| `proof_url` | TEXT | URL del comprobante en Storage (opcional) |
| `status` | TEXT | Estado: `PENDING`, `APPROVED`, `REJECTED`. Un pago revertido administrativamente queda en `REJECTED` con `notes` prefijado `"REVERSED: <motivo>"`. |
| `notes` | TEXT | Notas adicionales (opcional). Los pagos revertidos tienen el prefijo `REVERSED:` seguido del motivo. |
| `processed_by` | UUID | ID del admin/board que procesó el pago |
| `processed_at` | TIMESTAMP | Fecha de procesamiento |

#### Factura/Invoice (`invoices`)
Representa recibos unificados del sistema: tanto deudas de condominio como gastos de caja chica. El campo `tag` diferencia entre recibos normales y de caja chica.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `unit_id` | UUID (nullable) | Unidad a la que se carga la deuda. Nullable para invoices a nivel de edificio (caja chica) |
| `building_id` | UUID (nullable) | Edificio al que pertenece. Usado en invoices de caja chica |
| `tag` | VARCHAR(20) | Etiqueta: `NORMAL` (recibo de condominio) o `PETTY_CASH` (gasto de caja chica). Default: `NORMAL` |
| `type` | VARCHAR | Tipo: `EXPENSE`, `DEBT`, `EXTRAORDINARY`, `PETTY_CASH_REPLENISHMENT` (deprecated) |
| `amount` | NUMERIC | Monto de la factura |
| `paid_amount` | NUMERIC | Monto pagado hasta ahora. **El dominio (`Invoice.addPayment` / `Invoice.subtractPayment`) es el único mutador**. Los triggers de BD que antes recalculaban `paid_amount` fueron dropeados; ver sección 7.2. |
| `period` | TEXT | Período en formato `YYYY-MM` (ej: "2026-01") |
| `description` | TEXT | Descripción de la factura. En caja chica: `"[CATEGORÍA] descripción"` |
| `receipt_number` | TEXT | Número de recibo (opcional) |
| `status` | TEXT | Estado: `PENDING`, `PARTIAL`, `PAID`, `CANCELLED`. Ver grafo de transiciones en sección 6. |
| `due_date` | DATE | Fecha de vencimiento (opcional) |

**Constraints**:
- `CHECK (unit_id IS NOT NULL OR building_id IS NOT NULL)` — al menos uno debe estar presente. Permite invoices a nivel de unidad (recibos normales) o a nivel de edificio (gastos de caja chica).
- `CHECK (status IN ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED'))`.

**Invariantes del dominio** (enforced by `Invoice` entity):
- `amount >= 0`.
- Transiciones de estado validadas por un grafo explícito (`assertCanTransitionTo`). `CANCELLED` es el único estado terminal; `PAID` puede volver a `PARTIAL`/`PENDING` para soportar reversas.
- `Invoice.addPayment(amount)` rechaza si `paid_amount + amount > amount` (el excedente debe ir al credit ledger, no a la invoice).
- `Invoice.subtractPayment(amount)` clampa a 0 en el lower bound.

#### Asignación de Pago (`payment_allocations`)
Vincula pagos con facturas, permitiendo pagos parciales y que un pago cubra múltiples facturas.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `payment_id` | UUID | ID del pago |
| `invoice_id` | UUID | ID de la factura |
| `amount` | NUMERIC | Monto asignado de este pago a esta factura |

#### Caja Chica — Fondo (`petty_cash_fund`)
Metadata del fondo de caja chica por edificio. Cada edificio tiene un único fondo (CONSTRAINT `UNIQUE(building_id)`). El balance **no vive acá** — se deriva de la vista `petty_cash_balance`.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `building_id` | UUID (UNIQUE) | Edificio al que pertenece |
| `updated_at` | TIMESTAMPTZ | Última actualización del metadata |

> **Phase 3 drop** (2026-04-19): las columnas legacy `current_balance` y `currency` fueron eliminadas. El balance se calcula desde el ledger; el sistema no es multi-currency hoy y el campo era decorativo.

#### Caja Chica — Ledger (`petty_cash_entries`)
Libro mayor **append-only** de movimientos de caja chica. Una fila = una operación. Jamás se actualizan filas existentes; reversas y correcciones se expresan como contra-asientos. Mismo patrón que `unit_credit_ledger`.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `fund_id` | UUID | Fondo al que pertenece |
| `type` | TEXT | `income` \| `expense` \| `collection` \| `reversal` (CHECK) |
| `amount` | DECIMAL(12,2) | **Monto firmado** (CHECK `!= 0`). Positivo: `income` / `collection`. Negativo: `expense`. Reversal: signo flipeado respecto al original. |
| `category` | VARCHAR(50) | Solo para `expense`. Valores de `PettyCashCategory` (`REPAIR`, `CLEANING`, `EMERGENCY`, `OFFICE`, `UTILITIES`, `OTHER`). |
| `description` | TEXT | Descripción legible |
| `evidence_url` | TEXT (nullable) | Comprobante del gasto (solo `expense`) |
| `reference_type` | TEXT (nullable) | `manual` (board lo creó), `invoice_payment` (auto-collection cuando un resident paga), `reversal` (contra-asiento) |
| `reference_id` | UUID (nullable) | Apunta al `invoices.id` (si `invoice_payment`) o al `petty_cash_entries.id` original (si `reversal`) |
| `created_by` | UUID | Usuario que originó la entry |
| `created_at` | TIMESTAMPTZ | Fecha de creación |

**Invariantes del dominio** (enforced by `PettyCashEntry` entity):
- `amount != 0`.
- Sign matches type: `income`/`collection` > 0; `expense` < 0; `reversal` cualquier signo no-cero.
- `description` no puede ser string vacío.
- Static factory `PettyCashEntry.reversalOf(original, opts)` genera el contra-asiento con `amount = -original.amount`, `reference_type = reversal`, `reference_id = original.id`.

**Índices**: `(fund_id)`, `(created_at)`, `(reference_type, reference_id) WHERE reference_type IS NOT NULL`.

#### Caja Chica — Balance (`petty_cash_balance`)
**Vista SQL** (no materializada) que calcula el balance al vuelo sumando el ledger. Siempre consistente con `petty_cash_entries` — cualquier INSERT se refleja en la próxima query.

```sql
SELECT fund_id, COALESCE(SUM(amount), 0) AS balance
FROM petty_cash_entries GROUP BY fund_id
```

**Read-only**. El backend lee de aquí para obtener el balance actual; el historial detallado sale de `petty_cash_entries`.

**Balance puede ser negativo** (overdraft): si los egresos exceden los ingresos + collections, el balance va negativo. Ese negativo ES el overage pendiente; el próximo assessment lo cobra a las units.

#### Caja Chica — Assessment Batch (`petty_cash_assessment`)
Una ronda nombrada de prorrateo a units. **Múltiples batches por período son esperados** (ej: ascensor abril + agua abril = 2 batches con 2 invoices por unit cada uno, progreso independiente). Las invoices PETTY_CASH unit-level linkean al batch via `invoices.assessment_id`.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `fund_id` | UUID | Fondo al que pertenece |
| `period` | TEXT | Período en formato `YYYY-MM` |
| `description` | TEXT | Nombre del batch. Se copia a cada invoice generada (ej: `"Ascensor abril"`) |
| `category` | VARCHAR(50) (nullable) | Categoría opcional del batch para dashboards (usa `PettyCashCategory`) |
| `total_amount` | DECIMAL(12,2) | Monto total prorrateado (CHECK `> 0`). Redundante con `SUM(invoices.amount)` pero cacheado para reporting |
| `created_by` | UUID | Admin/Board que creó el batch |
| `created_at` | TIMESTAMPTZ | Fecha de creación |

**Invariantes del dominio** (enforced by `PettyCashAssessment` entity):
- `period` cumple regex `^\d{4}-\d{2}$`.
- `description` no puede ser string vacío.
- `total_amount > 0`.

**Nota sobre invoices**: la tabla `invoices` recibe una columna `assessment_id UUID NULL REFERENCES petty_cash_assessment(id) ON DELETE SET NULL`. Solo invoices PETTY_CASH generadas por un assessment batch la tienen.

#### Crédito por Unidad — Ledger (`unit_credit_ledger`)
**Libro mayor append-only** (source of truth) de movimientos de crédito/débito por unidad. Cada fila es un asiento contable inmutable. Los sobrepagos, excedentes no asignados y reversas se expresan como filas nuevas (nunca se borran ni se actualizan filas existentes).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `unit_id` | UUID | Unidad que tiene el crédito |
| `amount` | DECIMAL(12,2) | Monto. **Positivo** = crédito acumulado; **negativo** = contra-asiento (reversas / débitos). CHECK: `!= 0` |
| `reason` | TEXT | Razón legible del asiento. El texto se usa para distinguir tipos: `"Excedente de pago en factura <id>"` (invoice overpayment), `"Excedente no asignado del pago <id>"` (unallocated surplus), `"Reversión de pago <id>: <motivo>"` (reversa). |
| `reference_type` | ENUM | `payment`, `reversal`, `manual_adjustment`. Usa strings narrow validados en el dominio via `CreditLedgerReferenceType`. |
| `reference_id` | UUID | ID del recurso que causó el asiento (siempre el `payment.id` tanto para el credit original como para su reversa — el `reason` es el que distingue). |
| `created_at` | TIMESTAMPTZ | Fecha de creación |

**Invariantes del dominio** (enforced by `CreditLedgerEntry` entity):
- `amount != 0`.
- `unit_id`, `reason`, `reference_id` no pueden ser strings vacíos.
- `reference_type` debe ser un valor válido del enum.
- Static factory `CreditLedgerEntry.reversalOf(original, reason)` genera el contra-asiento con `amount = -original.amount`, `reference_type = REVERSAL`, preservando `unit_id` y `reference_id` para trazabilidad.

#### Crédito por Unidad — Balance (`unit_credit_balance`)
**Vista SQL normal** (NO materializada) que calcula al vuelo el saldo a favor de cada unidad sumando el ledger. Siempre consistente con `unit_credit_ledger` — cualquier INSERT se refleja inmediatamente en la próxima query.

```sql
SELECT unit_id, COALESCE(SUM(amount), 0) AS balance
FROM unit_credit_ledger GROUP BY unit_id
```

**Read-only**. El backend lee de `unit_credit_balance` para obtener el total actual y de `unit_credit_ledger` para el historial detallado.

#### Directorio de Junta — Vista (`board_members_directory`)
**Vista SQL** que consolida los miembros de junta (`building_members.role = 'board'`) con los datos de su perfil y la unidad asignada. Una fila por miembro: `DISTINCT ON (bm.id) ... ORDER BY bm.id, pu.created_at DESC` elige la unidad más recientemente asignada cuando el profile tiene varias vinculadas por `profile_units`. Si el profile no tiene unit asignada, las columnas `unit_*` quedan en NULL (el backend traduce eso en `unit: undefined`).

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `member_id` | UUID | ID de la fila en `building_members` |
| `role` | TEXT | Siempre `'board'` (la vista filtra por ese rol) |
| `building_id` | UUID | Edificio al que pertenece la membresía |
| `profile_id` | UUID | ID del perfil |
| `profile_name` | TEXT | Nombre del miembro |
| `profile_email` | TEXT | Email del miembro |
| `profile_phone` | TEXT (nullable) | Teléfono |
| `unit_id` | UUID (nullable) | Unidad más recientemente asignada al miembro |
| `unit_name` | TEXT (nullable) | Nombre/número de la unidad |
| `unit_assigned_at` | TIMESTAMPTZ (nullable) | `profile_units.created_at` de la unidad elegida |

**Grants**: `SELECT` concedido a `authenticated` y `service_role`.

#### Lead (`leads`)
Registros de personas interesadas en la aplicación (módulo de captación).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `fullName` | TEXT | Nombre completo |
| `contact` | TEXT | Teléfono de contacto |
| `email` | TEXT | Correo electrónico |
| `buildingName` | TEXT | Nombre del edificio |
| `location` | TEXT | Ubicación del edificio |
| `estimatedUsers` | TEXT | Rango estimado de usuarios |

---

## 5. Módulos y Acciones del Sistema

### 5.1 Módulo de Autenticación (`/auth`)

| Endpoint | Método | Autenticación | Descripción |
|----------|--------|---------------|-------------|
| `/auth/register` | POST | ❌ Pública | Registrar nuevo residente. Requiere: `name`, `email`, `password`, `unit_id`, `building_id`. Retorna JWT y datos del usuario. El usuario queda en estado `pending`. |
| `/auth/login` | POST | ❌ Pública | Iniciar sesión con email y contraseña. Retorna JWT con `access_token`, `refresh_token`, `expires_in` y perfil completo (rol, unidades, roles de edificio). |

### 5.2 Separación de Rutas: Públicas, APK y Web Admin

El sistema organiza los endpoints en tres niveles según quién los consume:

#### Rutas Públicas (sin prefijo)
No requieren autenticación. Usadas para registro, login y consulta de edificios.

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/auth/register` | POST | Registrar nuevo residente |
| `/auth/login` | POST | Iniciar sesión |
| `/buildings` | GET | Listar edificios disponibles |
| `/buildings/:id` | GET | Detalle de un edificio |
| `/buildings/:id/units` | GET | Listar unidades de un edificio |
| `/buildings/units/:id` | GET | Detalle de una unidad |
| `/api/register-download` | POST | Registrar interés de descarga (leads) |
| `/health` | GET | Health check |
| `/swagger` | GET | Documentación interactiva OpenAPI |

#### Rutas APK — `/api/v1/app/`
**Exclusivas para Residentes**. Board y Admin no usan la APK. Solo operaciones de lectura + reporte de pagos.

| Endpoint | Método | Tag Swagger | Descripción |
|----------|--------|-------------|-------------|
| `/users/me` | GET | App - Users | Mi perfil |
| `/users/me` | PATCH | App - Users | Actualizar mi perfil (nombre, teléfono) |
| `/billing/units/:id/balance` | GET | App - Billing | Balance de deuda de mi unidad. Incluye `creditBalance` y `netBalance` (clamped a 0). |
| `/billing/units/:id/invoices?tag=` | GET | App - Billing | Mis invoices (filtrable por tag) |
| `/billing/units/:id/credit` | GET | App - Billing | Mi crédito/saldo a favor. Response con `reference_type` narrow: `payment` \| `reversal` \| `manual_adjustment`. |
| `/billing/invoices/:id` | GET | App - Billing | Detalle de una invoice. Residents solo pueden ver invoices de sus propias units (ownership check). |
| `/billing/invoices/:id/payments` | GET | App - Billing | Lista los pagos aplicados a una invoice (joined con allocation info). Ownership check por unit. |
| `/payments` | GET | App - Payments | Mi historial de pagos |
| `/payments/summary` | GET | App - Payments | Mi resumen de solvencia |
| `/payments/:id` | GET | App - Payments | Detalle de un pago |
| `/payments` | POST | App - Payments | Reportar pago con comprobante. `allocations[]` es un array de intenciones explícitas — cada entrada dice "aplicar N a esta invoice"; el excedente entre `payment.amount` y `sum(allocations)` se convierte en credit. |
| `/petty-cash/funds/:buildingId` | GET | App - Petty Cash | Balance caja chica (lectura, derivado de `petty_cash_balance`) |
| `/petty-cash/funds/:buildingId/entries` | GET | App - Petty Cash | Historial del ledger (lectura) |
| `/buildings` | GET | Buildings | Lista de edificios disponibles. Mirror del endpoint público — expuesto también bajo `/api/v1/app/` para que el cliente APK autenticado no salga del prefijo. |
| `/buildings/:id` | GET | Buildings | Detalle de un edificio. Mirror del endpoint público. |
| `/buildings/:id/units` | GET | Units | Listado de unidades de un edificio. Mirror del endpoint público. |
| `/buildings/units/:id` | GET | Units | Detalle de una unidad. Mirror del endpoint público. |
| `/directory/buildings/:id/board` | GET | Directory | Listado de miembros de junta del edificio (profile + unit asignada). Retorna array de `BoardMember`. Misma ruta se expone en Web Admin bajo `/api/v1/admin/directory/...`. |

#### Rutas Web Admin — `/api/v1/admin/`
**Exclusivas para Board y Admin.** Si un Resident intenta acceder, recibe 403. Toda la gestión administrativa se concentra aquí.

**Facturación (Admin - Billing)**:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/billing/invoices?tag=&page=&limit=` | GET | Lista **paginada** de invoices. Query params: `page` (default `1`), `limit` (default `10`), `unit_id`, `building_id`, `status`, `period`, `year`, `user_id`, `tag` (NORMAL / PETTY_CASH). Response: `{ data: AdminInvoice[], metadata: { total, page, limit, total_pages, has_next_page, has_prev_page } }`. |
| `/billing/invoices/preview` | POST | Pre-visualizar facturas desde Excel |
| `/billing/invoices/confirm` | POST | Confirmar y cargar facturas desde Excel |
| `/billing/debt` | POST | Cargar deuda manual a una unidad |
| `/billing/units/:id/balance` | GET | Balance de deuda de una unidad |
| `/billing/units/:id/invoices?tag=` | GET | Invoices de una unidad (filtrable por tag) |
| `/billing/units/:id/credit` | GET | Crédito/saldo a favor de una unidad |
| `/billing/invoices/:id` | GET | Detalle de un invoice |
| `/billing/invoices/:id/payments` | GET | Pagos asignados a un invoice |
| `/billing/payments/:id/invoices` | GET | Invoices asociados a un pago |

**Pagos (Admin - Payments)**:

El grupo `/payments/admin/*` está gated por `.use(requireRole([ADMIN, BOARD]))` a nivel de plugin — residents reciben `403` inmediato en cualquier endpoint admin. **Antes de este fix (commit `0da5961`) residents podían revertir pagos de cualquier edificio; era un P0 de seguridad crítico**.

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/payments` | GET | Historial de pagos |
| `/payments/summary` | GET | Resumen de solvencia |
| `/payments/:id` | GET | Detalle de un pago |
| `/payments` | POST | Reportar pago |
| `/payments/admin/payments` | GET | Listar todos los pagos (filtros: `building_id`, `status`, `year`, `unit_id`) |
| `/payments/admin/payments/:id` | PATCH | Aprobar o rechazar un pago. Body: `{ status: "APPROVED" \| "REJECTED" \| "PENDING", notes? }`. El approve tiene pre-flight validation — si alguna allocation apunta a una invoice `CANCELLED`, devuelve 409 sin persistir nada y el payment queda `PENDING` para rechazo manual. |
| `/payments/admin/payments/:id/reverse` | POST | **Revertir un pago ya APPROVED** — el payment queda `REJECTED` con prefijo `REVERSED:`, se restan los montos aplicados a las invoices afectadas, las allocations se borran, y se generan contra-asientos en el credit ledger para cualquier credit que el pago haya generado. Body: `{ reason: string }` (minLength 10, maxLength 500 — valida al edge). |

**Caja Chica (Admin - Petty Cash)** — RESTful, recurso `funds` con sub-recursos `transactions` y `assessments`:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/petty-cash/funds/:buildingId` | GET | Balance actual del fondo (metadata + balance derivado). No incluye `currency` — eliminada en Phase 3 |
| `/petty-cash/funds/:buildingId/entries` | GET | Historial del ledger (filtros: `type`, `category`, `page`, `limit`). Shape nuevo: `{ id, fund_id, type, amount (firmado), category, description, evidence_url, reference_type, reference_id, created_by, created_at }` |
| `/petty-cash/funds/:buildingId/entries` | POST | Crear entry. `type` ∈ `income` \| `expense`. `income`: amount > 0 → balance sube. `expense`: amount > 0 (el backend guarda como negativo) → balance baja y puede ir negativo. `category` y `evidence_image` solo para `expense`. No genera invoices building-level (modelo ledger) |
| `/petty-cash/funds/:buildingId/entries/:entryId/reverse` | POST | Emitir counter-asiento sobre una entry. Body: `{ reason }` (10..500 chars). Idempotente. Rechaza reversar una entry type=reversal (409) |
| `/petty-cash/funds/:buildingId/assessments` | GET | Preview del próximo prorrateo: `current_balance`, `total_overage = max(0, -balance)`, `already_assessed` (invoices activas ≠ CANCELLED), `pending_to_assess`, `units[]` con distribución fair-to-cent |
| `/petty-cash/funds/:buildingId/assessments` | POST | Generar **batch con nombre**. Body: `{ description, amount, category? }`. Crea una fila en `petty_cash_assessment` + una invoice PENDING por unit linkeada via `assessment_id`. Múltiples batches por período son esperados |
| `/petty-cash/funds/:buildingId/transparency?period=YYYY-MM` | GET | **Vista de transparencia del estado de cobro de caja chica**, por período específico. Devuelve por cada unit: `expected_amount` (su cuota), `covered_amount` (capado a la cuota — los sobrepagos no inflan la recaudación del grupo), `status` (`PENDING` \| `PARTIAL` \| `PAID`). El response incluye `total_to_collect`, `total_collected` y `collection_percentage`. Invoices `CANCELLED` se excluyen del total. **`period` es query param requerido** — llamadas sin él devuelven `422`. |

**Edificios (Admin - Buildings)**:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/buildings` | POST | Crear edificio |
| `/buildings/:id` | PATCH | Actualizar edificio |
| `/buildings/:id/units` | POST | Crear unidad individual |
| `/buildings/:id/units/batch` | POST | Crear unidades en lote |

**Directorio (Directory)** — disponible tanto en APK como en Web Admin (la ruta APK va sin el check de `requireRole`; la admin queda gated por `requireRole([ADMIN, BOARD])` a nivel del plugin):

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/directory/buildings/:id/board` | GET | Lista de miembros de junta (`role = 'board'` en `building_members`) de un edificio. Response: array de `{ member_id, role, building_id, profile: { id, name, email, phone? }, unit?: { id, name } }`. Lee de la vista `board_members_directory` — una fila por miembro (la `DISTINCT ON` elige la unidad más recientemente asignada por `profile_units.created_at DESC`). |

**Usuarios (Admin - Users)**:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/users` | GET | Listar usuarios (filtros: `building_id`, `unit_id`, `role`, `status`) |
| `/users/:id` | GET | Detalle de un usuario |
| `/users/:id` | PATCH | Actualizar usuario |
| `/users/:id/approve` | POST | Aprobar registro pendiente |
| `/users/:id/units` | GET | Unidades de un usuario |
| `/users/:id/units` | POST | Asignar unidad a usuario |
| `/users/:id/roles` | POST | Actualizar rol de usuario en un edificio |
| `/users` | POST | Crear usuario (Admin only) |
| `/users/:id` | DELETE | Eliminar usuario (Admin only) |

#### Filtro por Tag (etiqueta de recibo)
El query param `tag` es opcional en los endpoints de invoices:
- **Sin `tag`**: Retorna TODOS los invoices
- **`tag=NORMAL`**: Solo recibos de condominio (deuda mensual, extraordinarios)
- **`tag=PETTY_CASH`**: Solo gastos de caja chica registrados como recibos

### 5.3 Módulo de Leads / Captación (`/api`)

| Endpoint | Método | Autenticación | Descripción |
|----------|--------|---------------|-------------|
| `/api/register-download` | POST | ❌ Pública | Registrar interés de descarga de la app. Campos: `fullName`, `contact`, `email`, `buildingName`, `location`, `estimatedUsers` |

### 5.4 Paginación estándar

Todos los endpoints de **listado del panel admin** devuelven el mismo shape. Los endpoints de **detalle** (`GET /:id`) devuelven el objeto plano, sin envolver.

#### Query params

| Param | Tipo | Default | Reglas |
|---|---|---|---|
| `page` | number (1-indexed) | `1` | Cualquier valor `< 1` se trata como `1` |
| `limit` | number \| `"all"` | `20` | Numérico → clamp silencioso a `[1..100]`. `"all"` → devuelve hasta `10000` rows (cap hard); si el total excede el cap, `metadata.has_next_page = true` para indicar truncación |

Filtros preexistentes de cada endpoint (ej: `status`, `building_id`, `period`, `tag`) **siguen funcionando y componen** con `page`/`limit`. `metadata.total` refleja el total del conjunto filtrado, no el total absoluto de la tabla.

#### Response shape

```json
{
  "data": [...],
  "metadata": {
    "total": 142,            // rows totales que matchean filtros
    "page": 3,               // página devuelta
    "limit": 20,             // items por página (o items.length si limit=all)
    "total_pages": 8,         // Math.ceil(total/limit). 0 si total=0
    "has_next_page": true,     // page < total_pages
    "has_prev_page": true      // page > 1
  }
}
```

#### Edge cases

- **Lista vacía** → `{ data: [], metadata: { total: 0, page: 1, limit: 20, total_pages: 0, has_next_page: false, has_prev_page: false } }`.
- **page > total_pages** → `data: []` con metadata correcto (sigue siendo 200, no 404).
- **limit fuera de rango** → clamp silencioso al max (100 numérico; 10k para `all`).
- **limit=all con total > 10000** → `data` trunca a 10000 items; `metadata.has_next_page=true` señala que hay más.
- **page o limit no numéricos** (y no `"all"`) → 400 `VALIDATION_ERROR` por Elysia schema validation.

#### Endpoints paginados (10)

| Endpoint | Notas |
|---|---|
| `GET /api/v1/admin/billing/invoices` | Primer endpoint paginado. `ORDER BY created_at DESC` |
| `GET /api/v1/admin/billing/invoices/:id/payments` | Pagos aplicados a una invoice |
| `GET /api/v1/admin/billing/payments/:id/invoices` | Invoices cubiertos por un payment |
| `GET /api/v1/admin/billing/units/:id/invoices` | Invoices de una unidad |
| `GET /api/v1/admin/users` | Ver nota sobre post-filter de scoping |
| `GET /api/v1/admin/users/:id/units` | Unidades asignadas al user |
| `GET /api/v1/admin/payments/admin/payments` | Historial de payments (admin) |
| `GET /api/v1/admin/petty-cash/funds/:buildingId/entries` | Ledger entries |
| `GET /api/v1/admin/buildings` | Edificios |
| `GET /api/v1/admin/buildings/:id/units` | Unidades de un edificio |

**Notas importantes**:
- Los endpoints de **detalle** (`GET /users/:id`, `GET /billing/units/:id/balance`, etc.) devuelven el objeto plano, sin `{data,metadata}`.
- Las **rutas públicas** `/buildings`, `/buildings/:id`, `/buildings/:id/units` (sin prefijo `/admin`) y los **mirrors APK** bajo `/api/v1/app/buildings/*` **mantienen array plano** — se usan para el flujo de registro sin auth. No tocarlas.
- `GET /api/v1/app/payments` (APK, historial del propio resident) **no está paginado** — devuelve array plano. Volumen esperado pequeño.
- **`GET /admin/users` scoping tangled**: el post-filter por building (Board scoping) corre en memoria después del SELECT — `metadata.total` refleja el set post-filtrado pero el `range()` de Supabase se aplica antes del post-filter. Para casos de board con pocos users esto es correcto; si el universo SQL-level crece mucho, migrar a una vista o RPC. Comentario en `SupabaseUserRepository.findAllPaginated`.

#### Ejemplo de consumo (cliente)

```js
const res = await fetch('/api/v1/admin/billing/invoices?page=2&limit=20&status=PENDING');
const { data: invoices, metadata } = await res.json();
console.log(`Mostrando ${invoices.length} de ${metadata.total} (página ${metadata.page}/${metadata.total_pages})`);

// "Dame todo sin paginar" — útil para exports, autocompletes, dropdowns.
const all = await fetch('/api/v1/admin/users?limit=all');
const { data: users, metadata: meta } = await all.json();
if (meta.has_next_page) {
    console.warn(`Truncado: el servidor devolvió los primeros ${meta.limit} de ${meta.total}`);
}
```

---

## 6. Enumeraciones del Sistema

### Métodos de Pago
| Valor | Descripción |
|-------|-------------|
| `PAGO_MOVIL` | Pago móvil (sistema bancario venezolano) |
| `TRANSFER` | Transferencia bancaria |
| `CASH` | Efectivo |

### Estados de Pago
| Valor | Descripción |
|-------|-------------|
| `PENDING` | Pago reportado, pendiente de revisión |
| `APPROVED` | Pago aprobado por Admin o Board |
| `REJECTED` | Pago rechazado por Admin/Board, O pago revertido administrativamente (en ese caso `notes` empieza con `REVERSED: <motivo>`) |

### Estados de Invoice
| Valor | Descripción |
|-------|-------------|
| `PENDING` | Factura emitida, `paid_amount = 0` |
| `PARTIAL` | Pago parcial aplicado: `0 < paid_amount < amount` |
| `PAID` | Totalmente pagada: `paid_amount >= amount` |
| `CANCELLED` | Cancelada administrativamente. **Estado terminal** — ninguna transición sale de acá |

**Grafo de transiciones** (validado por `Invoice.assertCanTransitionTo`):

```
PENDING   → PARTIAL, PAID, CANCELLED
PARTIAL   → PENDING, PAID, CANCELLED
PAID      → PARTIAL, PENDING             (soporta reversas de pago)
CANCELLED → (terminal — ninguna transición)
```

**Nota importante**: `PAID` NO es terminal. Una reversa de pago puede bajar `paid_amount` y llevar la invoice de vuelta a `PARTIAL` o `PENDING`. Un intento de transición ilegal (ej: `CANCELLED → PAID`) tira `DomainError` con code `INVALID_STATE_TRANSITION` y HTTP 409.

### CreditLedgerReferenceType (tipo de asiento en `unit_credit_ledger`)
| Valor | Descripción |
|-------|-------------|
| `payment` | Credit generado por un pago. Cubre **dos subcasos distinguidos por el `reason`**: invoice-level overpayment (`"Excedente de pago en factura <id>"`) y unallocated surplus (`"Excedente no asignado del pago <id>"`). |
| `reversal` | Contra-asiento de una reversa. `amount` es negativo. Vinculado al mismo `reference_id` del credit original para trazabilidad. |
| `manual_adjustment` | Ajuste manual (no usado por flujos automáticos hoy, reservado para ajustes administrativos futuros) |

### Estado de Solvencia
| Valor | Descripción |
|-------|-------------|
| `SOLVENT` | Al día con todos los pagos |
| `PENDING` | Tiene períodos pendientes (factura generada pero no pagada) |
| `OVERDUE` | Tiene pagos vencidos |

### Etiqueta de Recibo (InvoiceTag)
| Valor | Descripción |
|-------|-------------|
| `NORMAL` | Recibo de condominio (deuda mensual, extraordinario) |
| `PETTY_CASH` | Gasto de caja chica registrado como recibo |

### Categorías de Caja Chica
| Valor | Descripción |
|-------|-------------|
| `REPAIR` | Reparaciones |
| `CLEANING` | Limpieza |
| `EMERGENCY` | Emergencias |
| `OFFICE` | Material de oficina |
| `UTILITIES` | Servicios públicos |
| `OTHER` | Otros gastos |

### Tipo de Transacción de Caja Chica
| Valor | Descripción |
|-------|-------------|
| `INCOME` | Ingreso al fondo |
| `EXPENSE` | Egreso/gasto del fondo |

---

## 7. Flujos de Negocio Principales

### 7.1 Registro y Aprobación de Residente
```
1. Residente se registra → POST /auth/register (email, nombre, contraseña, edificio, unidad)
2. Sistema crea cuenta en Supabase Auth + perfil con estado "pending"
3. Admin o Board ve usuarios pendientes → GET /users?status=pending
4. Admin/Board aprueba → POST /users/:id/approve
5. Estado cambia a "active" → Residente puede operar normalmente
```

### 7.2 Reporte y Aprobación de Pago (con detección de sobrepago)

**Nota arquitectónica importante** (commit `1280bce` — "Camino 2"): el dominio de la aplicación es el **único dueño** de `invoice.paid_amount` y de `invoice.status`. Los triggers de Postgres que antes recalculaban estos campos automáticamente fueron dropeados. El orden de operaciones y los invariantes los enforce el dominio vía `Invoice.addPayment`, `Invoice.subtractPayment`, `Invoice.updateStatus` y `Invoice.assertCanTransitionTo`.

**Modelo de allocations**: una `PaymentAllocation` es una **intención explícita** — "aplicar N unidades de este pago a esta invoice". No es una fracción que el backend divida. El cliente (APK / Web Admin) decide cómo distribuir el pago entre las invoices, y la suma de allocations **puede ser menor** que `payment.amount`. La diferencia = **unallocated surplus** → credit automático a la unit.

**Contrato de entrada (`POST /payments`, multipart/form-data)**:

| Campo | Tipo | Requerido | Regla |
|---|---|---|---|
| `amount` | number \| string | sí | `exclusiveMinimum: 0` — no acepta `0` ni negativos |
| `date` | string | sí | ISO-8601 `YYYY-MM-DD` (pattern enforced). **No puede ser futura**: `date > now` → 400 `FUTURE_DATE` |
| `method` | literal | sí | `PAGO_MOVIL` \| `TRANSFER` \| `CASH` |
| `reference` | string | sí para `PAGO_MOVIL` / `TRANSFER`, ignorado en `CASH` | Enforced en el use case → 400 `MISSING_BANK_INFO` si falta |
| `bank` | string | sí para `PAGO_MOVIL` / `TRANSFER`, ignorado en `CASH` | Enforced en el use case → 400 `MISSING_BANK_INFO` si falta |
| `proof_image` | file | sí **para todos los métodos** | PAGO_MOVIL/TRANSFER: captura bancaria. CASH: foto del recibo. Enforced en el schema + use case → 400 `MISSING_PROOF` si falta |
| `unit_id` | string | no | Se infiere del `primary unit` del residente si falta |
| `building_id` | string | no | Se infiere del unit si falta |
| `notes` | string | no | |
| `allocations` | array | no | Lista de `{ invoice_id, amount }` positivos. `sum(allocations) <= payment.amount` o 400. Sin allocations → todo va a credit |

```
1. Residente reporta pago → POST /payments
   Body (multipart): amount, date, method, proof_image, reference?, bank?,
                     unit_id?, building_id?, notes?, allocations?
   - payment.amount = monto total que el residente entregó.
   - allocations[] = lista de asignaciones explícitas { invoice_id, amount }.
   - Validación: sum(allocations.amount) <= payment.amount. Positivos obligatorios.
2. Pago se crea con estado PENDING. Allocations se persisten con el amount que vino del cliente.
3. Admin/Board revisa pagos pendientes → GET /payments/admin/payments?status=PENDING.

4. Admin/Board aprueba → PATCH /payments/admin/payments/:id { status: "APPROVED" }.

   El use case ApprovePayment ejecuta en este orden:

   4.1. Short-circuit de idempotency: si payment.status ya es APPROVED, retorna
        inmediatamente sin tocar nada (protege contra doble-click y retries).

   4.2. Carga allocations del pago.

   4.3. Pre-flight validation: para CADA allocation verifica
        ProcessInvoiceOverpayment.assertInvoiceCanAcceptPayment(invoice_id).
        Si alguna invoice está CANCELLED → DomainError 409 INMEDIATAMENTE
        sin persistir NADA. El payment queda PENDING para rechazo manual.
        (Este pre-check existe para evitar zombie state — ver sección 7.9.)

   4.4. Solo si pasa la pre-validación: payment.approve() + paymentRepo.update().

   4.5. Loop sobre allocations:
        - ProcessInvoiceOverpayment.execute({ invoiceId, paymentId, paymentAmount: alloc.amount }).
        - Calcula el split via OverpaymentService: applied = min(alloc.amount, invoice.remaining),
          credit = max(0, alloc.amount - invoice.remaining).
        - invoice.addPayment(applied) + invoice.updateStatus() + invoiceRepo.update().
        - Si generatedCredit > 0 y la invoice tiene unit_id: crea entry en unit_credit_ledger
          con reason "Excedente de pago en factura <id>". Idempotency check best-effort.
        - Si la invoice es building-level (sin unit_id) y hay credit: warn + drop (no hay unit
          destinataria — gap de spec documentado).

   4.6. Después del loop: calcula unallocatedSurplus = payment.amount - sum(alloc.amount).
        Si > 0 y payment.unit_id existe: crea entry en unit_credit_ledger con reason
        "Excedente no asignado del pago <id>". Este es el canal que cubre el caso más común
        del APK — pagar 100 contra invoice de 40 con allocation.amount = 40 genera credit de 60.

5. O rechaza → PATCH /payments/admin/payments/:id { status: "REJECTED", notes: "..." }.
   Los rechazos sobre pagos PENDING no tienen efectos financieros (solo cambio de estado).

6. Se registra quién procesó el pago (processed_by, processed_at).
```

**Limitación conocida (documentada en REVIEW_BACKLOG.md)**: el flujo de approve NO es transaccional. Si falla entre `paymentRepo.update` y el primer `ProcessInvoiceOverpayment.execute`, el payment queda APPROVED con allocations parcialmente procesadas. La pre-flight validation cubre el caso más común (allocation contra CANCELLED); otros fallos de DB pueden producir partial commits. El fix definitivo es envolver `approve()` en un Supabase RPC / unit-of-work.

### 7.3 Carga de Deuda (Facturación)
```
Opción A — Manual:
1. Admin/Board carga deuda → POST /billing/debt (unit_id, amount, period, description)
2. Se crea invoice con status calculado

Opción B — Masiva desde Excel:
1. Admin/Board sube archivo Excel → POST /billing/invoices/preview?building_id=xxx
2. Sistema parsea el Excel, valida unidades, muestra preview con warnings
3. Admin/Board confirma → POST /billing/invoices/confirm?building_id=xxx
4. Invoices se crean en lote
```

### 7.4 Consulta de Solvencia
```
1. Residente consulta → GET /payments/summary
2. Sistema calcula:
   - Estado de solvencia (SOLVENT, PENDING, OVERDUE)
   - Lista de períodos pagados
   - Lista de períodos pendientes
   - Últimas transacciones
3. Para detalle fino → GET /billing/units/:id/balance
   - Total de deuda
   - Facturas pendientes con detalle (monto, pagado, restante, período)
```

### 7.5 Gestión de Caja Chica (modelo ledger)

Todos los movimientos pasan por un único endpoint de entries. El balance se deriva en vivo de la vista `petty_cash_balance`; nunca se cachea.

```
Registrar Ingreso (reposición del fondo):
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/entries
   Body: { type: "income", amount, description }
2. INSERT único en petty_cash_entries (amount > 0, type=income,
   reference_type=manual). La vista refleja el nuevo balance al instante.

Registrar Egreso (gasto de la junta):
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/entries
   Body: { type: "expense", amount, description, category, evidence_image? }
2. INSERT único con amount = -<amount absoluto>, type=expense,
   category ∈ PettyCashCategory, reference_type=manual.
3. El balance puede quedar negativo (overdraft) — es esperado, no un
   error. Ese negativo es el overage que el próximo assessment va a cobrar.
   NO se generan invoices building-level PAID por el egreso (eran fantasma
   en el modelo anterior; el ledger ya guarda el egreso).

Auto-collection (ocurre sin intervención manual):
- Cuando un resident paga una invoice PETTY_CASH con unit_id vía
  POST /payments + ApprovePayment, se genera automáticamente una entry
  { type: "collection", amount: applied, reference_type: "invoice_payment",
    reference_id: <invoice_id> } en el ledger del building. El fondo se
  repone solo.
- Si ese payment se revierte vía POST /payments/admin/payments/:id/reverse,
  ReversePayment genera el counter-asiento correspondiente
  (type=reversal, amount=-applied) — el balance vuelve a su estado previo.

Reversa manual (corregir una entry con error):
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/entries/{entryId}/reverse
   Body: { reason: string (minLength 10, maxLength 500) }
2. Valida: entry existe, pertenece al fund del buildingId, y su type
   no es "reversal" (no se reversa una reversal — se emite una entry
   fresca con el signo correcto).
3. INSERT único con amount = -original.amount, type=reversal,
   reference_type=reversal, reference_id=<original_entry_id>.
4. Idempotente: si ya existe una reversal para este entry, devuelve la
   existente sin crear duplicado.

Consultas:
- Balance en vivo → GET /petty-cash/funds/{buildingId}
  Response: { id, building_id, current_balance (puede ser negativo), updated_at }
- Historial del ledger → GET /petty-cash/funds/{buildingId}/entries
  Filtros: ?type=, ?category=, ?page=, ?limit=.
  Response: array de entries con type, amount firmado, reference_type, reference_id.
```

### 7.6 Assessment Batches — Cobro Nombrado a Unidades

Los assessments son **batches con nombre**. El admin puede correr múltiples batches en el mismo período (ej: `"Ascensor abril"`, `"Agua abril"`) y cada uno tiene su propio progreso de recaudación.

```
Preview (cuánto falta por cobrar en total):
1. Board/Admin → GET /api/v1/admin/petty-cash/funds/{buildingId}/assessments
2. El sistema calcula (aritmética en integer-cents para evitar IEEE-754 drift):
   - current_balance: balance del ledger (puede ser negativo)
   - total_overage: max(0, -current_balance)
   - already_assessed: Σ amounts de invoices PETTY_CASH unit-level
     ACTIVAS (PENDING + PARTIAL + PAID). CANCELLED excluidas — fix del
     bug de la versión anterior donde las CANCELLED inflaban este total.
   - pending_to_assess: max(0, overage - already_assessed)
     (si el residuo es < 1 centavo, se clampea a 0)
   - units: lista con el monto que le tocaría a cada una si se cobra
     todo el pending ahora. Distribución justa al centavo: las primeras
     `remainder` units reciben 1 centavo extra.

Generar batch (cobrar a las units):
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/assessments
   Body:
     {
       description: "Ascensor abril",       // requerido — aparece en la
                                            // invoice de cada unit
       amount: 500,                         // total a prorratear en ESTE batch
                                            // (puede ser < pending_to_assess —
                                            // prorrateo parcial válido)
       category: "REPAIR"                   // opcional — enum PettyCashCategory
     }

2. El use case GenerateAssessments hace:
   a. findOrCreateFund (upsert atómico — cierra el bug histórico del
      fund.id='').
   b. Validaciones: description no-vacía, amount > 0, units.length > 0,
      amount en centavos ≥ units.length (AMOUNT_TOO_SMALL_TO_DISTRIBUTE).
   c. Distribución fair-to-cent: base = ⌊amount_cents / n⌋, remainder =
      amount_cents mod n. Las primeras `remainder` units reciben base+1.
   d. INSERT único en petty_cash_assessment (period, description, category,
      total_amount, created_by).
   e. invoiceRepo.createBatch(...) con una invoice PENDING por unit:
      - tag = PETTY_CASH, type = EXPENSE, status = PENDING
      - description = batch.description (literal, ej: "Ascensor abril")
      - assessment_id = batch.id ← backlink al batch
      - amount = cuota de esa unit

3. Response:
   {
     building_id,
     assessment_id,
     description: "Ascensor abril",
     total_assessed: 500,
     invoices_created: N,
     invoices: [{ unit_id, unit_name, amount, invoice_id }, ...]
   }

Ejemplo — 2 batches en el mismo período:
- POST assessments { description: "Ascensor abril", amount: 500, category: "REPAIR" }
  → 1 assessment + N invoices, description="Ascensor abril".
- POST assessments { description: "Agua abril", amount: 300, category: "UTILITIES" }
  → 2do assessment + N invoices más, description="Agua abril".
- Cada unit termina con 2 invoices PENDING del mismo período, cada
  una linkeada a su batch. El transparency desglosa progreso de cada
  batch por separado (ver 7.9).
```

### 7.7 Reverse de una entry del ledger (correcciones manuales)

```
POST /api/v1/admin/petty-cash/funds/{buildingId}/entries/{entryId}/reverse
Body: { reason: string (10..500 chars) }

Validaciones:
- entry existe y pertenece al fund del buildingId
  (scope check — un board de building A no puede reversar entries de B).
- entry.type != "reversal" (no se reversa una reversal).
- reason no-vacía.

Resultado:
- INSERT único en petty_cash_entries:
    type=reversal, amount=-original.amount,
    reference_type=reversal, reference_id=<original_entry_id>,
    description="Reversión: <reason>".
- Idempotente: si ya existe una reversal del entry, devuelve la existente
  sin crear duplicado.
- La entry original NO se modifica ni se borra (append-only).
```

### 7.8 Crédito / Saldo a Favor por Unidad

El `unit_credit_ledger` tiene **dos canales complementarios** que producen credit entries. Ambos usan `reference_type=payment` y `reference_id=<payment_id>`, pero el campo `reason` los distingue — lo que permite que `ReversePayment` encuentre todos los créditos de un pago con una sola query y genere contra-asientos para ambos.

**Canal A — Invoice-level overpayment** (`reason` empieza con `"Excedente de pago en factura"`):
```
Dispara cuando alloc.amount > invoice.remaining.
Ejemplo: payment.amount=150, allocation={invoice X, amount:150}, invoice X de $100.
  - OverpaymentService.calculate(100, 0, 150) → applied=100, credit=50.
  - invoice.addPayment(100) → PAID.
  - creditLedgerRepo.addCredit({ amount: 50, reason: "Excedente de pago en factura X" }).
```

**Canal B — Unallocated surplus** (`reason` empieza con `"Excedente no asignado del pago"`):
```
Dispara cuando sum(allocations) < payment.amount.
Ejemplo: payment.amount=100, allocation={invoice X, amount:40}, invoice X de $40.
  - ProcessInvoiceOverpayment aplica los 40 → invoice PAID, credit=0 (no hay overpayment).
  - ApprovePayment detecta surplus = 100 - 40 = 60.
  - creditLedgerRepo.addCredit({ amount: 60, reason: "Excedente no asignado del pago Y" }).

Este es el caso más común en la APK: la APK manda allocations capadas al
monto remaining de la invoice, y el surplus va automáticamente al credit.
```

**Caso especial — payment sin allocations**:
```
payment.amount=100, allocations=[].
→ Loop de allocations no corre.
→ unallocatedSurplus = 100 - 0 = 100 → credit ledger +100.
→ Permite al residente depositar directo a credit para usar después.
```

**Consulta**:
- Residente → `GET /billing/units/:id/credit`
- Retorna:
```json
{
  "balance": 60,
  "history": [
    {
      "id": "...",
      "unit_id": "...",
      "amount": 60,
      "reason": "Excedente no asignado del pago <id>",
      "reference_type": "payment",
      "reference_id": "<id>",
      "created_at": "..."
    }
  ]
}
```

**Consumo del crédito** (aplicar saldo a favor a recibos futuros): **planificado para una futura actualización**. Hoy el credit solo se acumula y se revierte.

### 7.9 Reversa de Pagos

Nuevo flujo administrativo introducido con esta rama. Permite al Board/Admin revertir un pago ya APPROVED, restaurando el estado previo del sistema contable.

```
1. Board/Admin → POST /payments/admin/payments/:id/reverse
   Body: { reason: string }  // minLength 10, maxLength 500

2. Pre-validación:
   - Payment debe estar en estado APPROVED. Si no → 403 "Only approved payments can be reversed".

3. payment.reject(requesterId, `REVERSED: ${reason}`)
   - El status del payment pasa a REJECTED.
   - notes queda con el prefijo REVERSED: seguido del motivo.
   - paymentRepo.update(payment).

4. Reversa de credit ledger:
   - Busca todas las entries con reference_id=paymentId y reference_type=PAYMENT.
   - Para cada una que sea crédito positivo, genera un contra-asiento via
     CreditLedgerEntry.reversalOf(original, reason) con amount negativo y
     reference_type=REVERSAL.
   - creditLedgerRepo.deductCredit(reversalEntry).
   - Esto revierte AMBOS canales: invoice overpayment y unallocated surplus,
     porque los dos comparten reference_id.

5. Reversa de invoices:
   - Carga las allocations del pago.
   - Para cada allocation:
     a. Carga la invoice.
     b. Si la invoice está CANCELLED: skip la mutación (no tiene sentido
        recalcular status de algo terminal) pero igual borra la allocation.
     c. Si no está CANCELLED:
        - invoice.subtractPayment(alloc.amount) — baja paid_amount (clamp a 0).
        - invoice.updateStatus() — recalcula el status según el nuevo paid_amount.
        - invoiceRepo.update(invoice).
   - Borra la allocation en todos los casos (allocationRepo.delete).

6. Response: { success: true }.
```

**Validaciones de input** (Elysia schema):
- `reason` es `t.String({ minLength: 10, maxLength: 500 })`. Forzar un mínimo útil evita notes vacíos o "x" en el audit trail.

**Limitaciones conocidas**:
- **No es transaccional**. Si falla entre la reversa del credit ledger y la reversa de invoices, queda estado inconsistente.
- **Distingue REVERSED de REJECTED solo por el prefijo del notes**. Un futuro rediseño podría introducir un estado `REVERSED` separado — por ahora ambos terminan en `REJECTED` y se distinguen por el contenido de `notes`.
- **Cross-building para BOARD**: un BOARD de edificio X puede ejecutar reverse sobre un pago de edificio Y (ReversePayment no tiene check interno de building membership; el guard `requireRole` solo chequea rol, no building). Pendiente de arreglar con `requireBuildingAccess` async-aware.

### 7.10 Transparencia de Caja Chica — Desglose por Assessment

La transparencia **agrupa invoices por `assessment_id`** para que cada batch tenga su propio progreso. Si la junta corrió múltiples batches en el mismo período (ascensor + agua), el response muestra cada uno con su `collection_percentage` independiente, más un agregado del período completo.

```
GET /api/v1/admin/petty-cash/funds/:buildingId/transparency?period=YYYY-MM
   - `period` es query param REQUERIDO. Sin él → 422.

Algoritmo (GetPettyCashTransparency):
1. Carga en paralelo:
   - units del edificio (unitRepo).
   - invoices PETTY_CASH del edificio para el período (invoiceRepo con filtro).
   - assessments del fund para el período (pettyCashRepo).

2. Indexa invoices activas (CANCELLED excluidas) por `assessment_id`.
   Invoices sin assessment_id (legacy, generadas antes de Phase 2) van
   a una bucket sintética "__legacy__" mostrada como "Sin categorizar".

3. Por cada batch:
   - Por cada unit con invoice(s) en el batch:
     * expected_amount = Σ invoice.amount (puede ser > 1 si una unit
       tiene varias invoices del mismo batch — edge case).
     * covered_amount  = Σ min(invoice.paid_amount, invoice.amount)
       → el cap por-invoice evita que overpayments inflen el %.
     * status: PAID si covered ≥ expected; PENDING si covered = 0;
       PARTIAL en el medio.
   - Σ expected + covered del batch → collection_percentage.

4. Agregados globales: suma expected/covered de todos los batches del
   período (usado por dashboards que quieren un número único del mes).

Response:
{
  building_id,
  period,
  assessments: [
    {
      id,                            // petty_cash_assessment.id
      description: "Ascensor abril",
      category: "REPAIR" | null,
      total_to_collect: 500,
      total_collected: 350,
      collection_percentage: 70,
      units: [
        { unit_id, unit_name, expected_amount, covered_amount, status },
        ...
      ]
    },
    { id, description: "Agua abril", ... }
  ],
  // Agregados globales (todos los assessments sumados)
  total_to_collect: 800,
  total_collected: 650,
  collection_percentage: 81.25
}
```

**Por qué el cap**: un residente que paga 100 contra una cuota de 80 NO debe inflar el `collection_percentage` del batch. Su excedente (20) va al `unit_credit_ledger` por el canal B (unallocated surplus), no al conteo de recaudación.

**Breaking change (Phase 2)**: el endpoint antes devolvía `units[]` a nivel top-level. Ahora `units[]` vive dentro de cada entrada de `assessments[]`. Los dashboards que solo consumen los totales globales (`total_to_collect`, `total_collected`, `collection_percentage`) mantienen compatibilidad — esos campos siguen en el top-level.

---

## 8. Seguridad

### Autenticación
- **JWT via Supabase Auth**: Todos los endpoints protegidos requieren header `Authorization: Bearer <token>`.
- Los tokens se obtienen vía `/auth/login` o `/auth/register`.
- Cada token incluye `access_token`, `refresh_token` y `expires_in`.

### Autorización por Capa
1. **Nivel de Ruta**: Guards composables validan JWT y permisos antes de ejecutar cualquier lógica:
   - `requireRole(roles[])`: Valida que el usuario tenga uno de los roles permitidos. Retorna 401 (sin token) o 403 (rol no permitido).
   - `requireBuildingAccess(getBuildingId)`: Valida que el usuario (Board) sea miembro del edificio solicitado. Admin bypasses automáticamente. Retorna 403 si no es miembro.
2. **Nivel de Negocio**: Los Use Cases verifican el rol del usuario que ejecuta la acción. **Ojo**: `ApprovePayment.approve/reject` tienen check interno de building membership; `ReversePayment` NO (pendiente de arreglar — ver REVIEW_BACKLOG.md).
3. **Nivel de Base de Datos**: Row Level Security (RLS) en Supabase como capa adicional de seguridad.

**Estado actual de auth en los tres módulos con route groups separados** (pendiente de unificación en una MR dedicada):
| Módulo | Patrón | Estado |
|---|---|---|
| `petty-cash` | `.use(requireRole(...))` + `.use(requireBuildingAccess(...))` en el plugin | ✅ Referencia correcta |
| `payments` admin | `.use(requireRole([ADMIN, BOARD]))` en el plugin (commit `0da5961`) | ✅ — pero sin `requireBuildingAccess` |
| `billing` admin | `.derive()` con profile + checks inline en cada handler | ⚠️ Inconsistente, frágil |

**P0 histórico cerrado en commit `0da5961`**: las rutas admin de payments usaban un `.derive()` raw que solo validaba el token, sin chequear rol. Combinado con `ReversePayment` sin check interno, cualquier residente autenticado podía revertir cualquier pago del sistema. Ahora está gated correctamente al nivel del plugin.

### Políticas RLS Principales
- **Profiles**: Cada usuario solo ve su perfil. Admin ve todos. Board ve perfiles de usuarios de su edificio.
- **Payments**: Cada usuario ve solo pagos de su unidad. Board ve pagos de su edificio. Admin ve todo.
- **Invoices**: Admin y Board pueden gestionar facturas. Residentes solo ven facturas de su unidad.
- **Units**: Admin y Board pueden crear/editar/eliminar unidades.
- **Petty Cash (Funds y Transactions)**: Board ve solo datos de edificios donde es miembro. Admin ve todo. Residentes no tienen acceso directo (el backend accede via service_role).
- **Credit Ledger**: Residentes ven crédito de su unidad. Board ve crédito de unidades de su edificio. Admin ve todo.

### Trazabilidad
- Cada request tiene un `X-Request-ID` único.
- Logs estructurados con Pino (método, URL, status, requestId).
- Se registra quién aprobó/rechazó cada pago (`processed_by`, `processed_at`).

---

## 9. Almacenamiento de Archivos

### Bucket: `payment-proofs`
- Almacena comprobantes de pago (imágenes) subidos por residentes.
- Los archivos se suben vía `multipart/form-data` en `POST /payments` (campo `proof_image`).
- Se almacenan con URL pública en Supabase Storage.
- También se usa para evidencias de egresos de caja chica (`evidence_image`).

---

## 10. Relación entre Usuarios, Unidades y Edificios

El sistema soporta relaciones muchos-a-muchos:

- **Un usuario puede tener múltiples unidades** (tabla `profile_units`): Útil para propietarios con varios apartamentos.
- **Una unidad puede tener múltiples usuarios**: Permite que una familia tenga varias cuentas para el mismo apartamento.
- **Una unidad marca `is_primary`**: Define la unidad principal del usuario (usada como default al registrar pagos).
- **Roles de edificio separados** (tabla `building_members`): Un usuario puede ser Board en un edificio y residente en otro.

### Diagrama de Relaciones
```
profiles (usuario)
    ├── profile_units (muchos-a-muchos) → units → buildings
    └── building_members (rol por edificio) → buildings

payments → unit_id, building_id, user_id
invoices → unit_id (nullable), building_id (nullable), tag (NORMAL|PETTY_CASH),
           assessment_id (nullable, FK a petty_cash_assessment)
payment_allocations → payment_id, invoice_id
unit_credit_ledger → unit_id (saldo a favor por sobrepago)
unit_credit_balance → VIEW sobre unit_credit_ledger

petty_cash_fund → building_id (UNIQUE, 1 por edificio) — solo metadata
petty_cash_entries → fund_id (append-only ledger, amount firmado)
petty_cash_balance → VIEW sobre petty_cash_entries (SUM por fund_id)
petty_cash_assessment → fund_id (batches nombrados para cobro a units)

Relación caja chica → cobro a unidades:
  POST /petty-cash/funds/:b/assessments { description, amount, category? }
    → INSERT petty_cash_assessment
    → createBatch de invoices (tag=PETTY_CASH, unit_id, status=PENDING,
                               assessment_id=<batch.id>)

Relación caja chica ↔ pagos (auto-collection loop):
  ApprovePayment: resident paga invoice PETTY_CASH con unit_id
    → INSERT petty_cash_entries { type=collection, amount=+applied,
                                  reference_type=invoice_payment,
                                  reference_id=<invoice.id> }
    → balance del fund sube automáticamente
  ReversePayment: revertir ese payment
    → INSERT petty_cash_entries { type=reversal, amount=-applied, ... }

Relación pagos → crédito:
  Aprobación de pago con sobrepago → crea entrada en unit_credit_ledger

Directorio de junta:
  board_members_directory → VIEW sobre building_members + profiles + profile_units + units
    (DISTINCT ON por member_id, pick la unidad más reciente)
```

---

| `/health` | GET | ❌ Pública | Retorna `{ status: "ok", timestamp: "..." }` para monitoreo |
| `/swagger` | GET | ❌ Pública | Documentación interactiva de la API (OpenAPI 3.0) |

---

## 12. Módulo de Decisiones (Presupuestos y Votaciones)

El módulo de Decisiones implementa el flujo completo de toma de decisiones colectivas dentro de un edificio: desde la recepción de cotizaciones de proveedores hasta la generación del cobro correspondiente a las unidades. Responde al caso de uso central en administración condominial — "*¿con quién contratamos el trabajo?*" — con trazabilidad total y participación democrática de los apartamentos.

El modelo es **machine de estados** con transiciones explícitas. Cada evento de importancia genera una entrada en el `decision_audit_log`, creando un registro inmutable de quién hizo qué y cuándo. Los cobros se generan como `INVOICE` (recibo individual a una unidad) o `ASSESSMENT` (prorrateo equitativo a todas las unidades del edificio), integrándose directamente con el módulo de Facturación.

### 12.1 Roles

| Acción | Admin | Board | Residente |
|--------|:-----:|:-----:|:---------:|
| Crear/cancelar decisión | ✅ | ✅ | ❌ |
| Ver decisiones del edificio | ✅ | ✅ | ✅ (solo activas) |
| Subir cotización | ✅ | ✅ | ✅ (durante RECEPTION) |
| Eliminar cotización | ✅ | ✅ | ✅ (solo la propia) |
| Votar | ✅ | ✅ | ✅ (por unidad asignada) |
| Finalizar/avanzar estado | ✅ | ✅ | ❌ |
| Resolver tiebreak manual | ✅ | ✅ | ❌ |
| Generar cargo (INVOICE/ASSESSMENT) | ✅ | ✅ | ❌ |
| Ver audit log | ✅ | ✅ | ❌ |

**Nota de acceso APK**: los residentes solo pueden votar en nombre de sus propias unidades (`profile_units`). El ownership check se valida en el transporte, no en el dominio.

### 12.2 Machine de Estados

```
RECEPTION  →  VOTING  →  RESOLVED   (flujo feliz: hay ganador claro)
               ↓               ↓
          TIEBREAK_PENDING  CHARGED   (estado informativo, no terminal por ahora)
               ↓
           RESOLVED         (tras resolución manual vía ResolveTiebreak)

RECEPTION  →  CANCELLED     (en cualquier momento antes de RESOLVED)
```

- **RECEPTION**: período de recepción de cotizaciones. Deadline controlado por `reception_deadline`.
- **VOTING**: deadline de votación activo (`voting_deadline`). Los apartamentos emiten un voto por ronda.
- **RESOLVED**: hay un `winner_quote_id`. La decisión puede generar un cargo.
- **TIEBREAK_PENDING**: dos rondas de votación terminaron empatadas. Requiere resolución manual de Board/Admin.
- **CANCELLED**: terminal. Registra `cancel_reason` y `cancelled_at`.

### 12.3 Endpoints — Web Admin (`/api/v1/admin/decisions`)

Todos requieren rol `ADMIN` o `BOARD`. Guard: `requireRole([ADMIN, BOARD])`.

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/decisions` | POST | Crear decisión. Body: `{ building_id, title, description?, reception_deadline, voting_deadline }`. Valida `voting_deadline > reception_deadline`. |
| `/decisions` | GET | Listar decisiones. Filtro: `?building_id=&status=`. |
| `/decisions/:id` | GET | Detalle de una decisión. |
| `/decisions/:id` | PATCH | Actualizar título/description (solo en RECEPTION). |
| `/decisions/:id/cancel` | POST | Cancelar. Body: `{ reason }`. Valida que la decisión no esté ya RESOLVED. |
| `/decisions/:id/finalize` | POST | Avanzar estado: RECEPTION→VOTING, VOTING→RESOLVED o TIEBREAK_PENDING. Body: `{ actor_user_id }`. |
| `/decisions/:id/tiebreak` | POST | Resolver tiebreak manualmente. Body: `{ winner_quote_id }`. Solo en estado TIEBREAK_PENDING. |
| `/decisions/:id/quotes` | GET | Listar cotizaciones. Query: `?include_deleted=true\|false`. |
| `/decisions/:id/quotes` | POST | Subir cotización. Body (multipart): `{ provider_name, amount, file }`. |
| `/decisions/:id/quotes/:qid` | DELETE | Eliminar cotización con razón obligatoria. Body: `{ reason }`. |
| `/decisions/:id/votes` | GET | Listar votos de la ronda activa. |
| `/decisions/:id/votes` | POST | Emitir voto. Body: `{ apartment_id, quote_id }`. |
| `/decisions/:id/results` | GET | Tally de la ronda activa. Ver shape en §12.6. |
| `/decisions/:id/charge` | POST | Generar cargo. Body: `{ type: "INVOICE"\|"ASSESSMENT", amount_override? }`. Solo en RESOLVED. Idempotente (rechaza si ya existe cargo). |
| `/decisions/:id/audit` | GET | Historial de auditoría. Array de `{ event, actor_user_id, payload, created_at }`. |
| `/decisions/:id/file-url` | POST | Obtener URL firmada para subir archivo de cotización (two-step upload). Body: `{ filename, mime_type }`. |

### 12.4 Endpoints — APK (`/api/v1/app/decisions`)

Acceso: token de sesión válido vía Supabase Auth. El `userId` y las `unitIds` se extraen del JWT en un `derive()` centralizado.

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/decisions` | GET | Listar decisiones activas del edificio del residente. |
| `/decisions/:id` | GET | Detalle de una decisión. |
| `/decisions/:id/quotes` | GET | Cotizaciones de la decisión (solo activas). |
| `/decisions/:id/quotes` | POST | Subir cotización propia (solo en RECEPTION). Body (multipart): `{ provider_name, amount, file }`. |
| `/decisions/:id/quotes/:qid` | DELETE | Eliminar propia cotización (soft-delete, razón hardcodeada). |
| `/decisions/:id/votes` | POST | Emitir voto por una unidad propia. Body: `{ apartment_id, quote_id }`. Valida que `apartment_id ∈ unitIds` del residente. |
| `/decisions/:id/results` | GET | Tally de la ronda activa (read-only). |

### 12.5 Flujo de Negocio Principal

```
1. Board/Admin crea la decisión:
   POST /decisions { building_id, title, reception_deadline, voting_deadline }
   → estado RECEPTION

2. Residentes (o Board/Admin) suben cotizaciones durante RECEPTION:
   POST /decisions/:id/quotes (multipart: provider_name, amount, file)
   → cada quote queda activa; puede ser soft-deleted por el uploader o por admin

3. Admin/Board finaliza la recepción:
   POST /decisions/:id/finalize
   → si hay ≥1 quote activa y reception_deadline expiró → VOTING
   → si no hay quotes activas → 422 DECISION_NO_ACTIVE_QUOTES

4. Apartamentos votan (1 voto por apartamento por ronda):
   POST /decisions/:id/votes { apartment_id, quote_id }
   → idempotencia: el mismo apartamento no puede votar dos veces en la misma ronda

5. Admin/Board finaliza la votación:
   POST /decisions/:id/finalize
   → ganador claro (mayoría simple) → RESOLVED con winner_quote_id
   → empate ronda 1 → TIEBREAK_OPENED (abre ronda 2, status sigue VOTING)
   → empate ronda 2 → TIEBREAK_PENDING (resolución manual requerida)
   → sin votos o sin quotes activas → TIEBREAK_PENDING

6a. Si RESOLVED: Admin/Board genera el cargo:
    POST /decisions/:id/charge { type: "INVOICE" | "ASSESSMENT" }
    → INVOICE: cobro a una unidad específica (el uploader del quote ganador)
    → ASSESSMENT: prorrateo justo entre todas las unidades del edificio
    → guarda resulting_type y resulting_id en la decisión

6b. Si TIEBREAK_PENDING: Admin/Board resuelve manualmente:
    POST /decisions/:id/tiebreak { winner_quote_id }
    → decisión pasa a RESOLVED, luego flujo normal de cargo

7. Audit trail disponible siempre:
   GET /decisions/:id/audit → array de eventos { CREATED, PHASE_ADVANCED,
   FINALIZED, TIEBREAK_OPENED, WINNER_SET_MANUAL, CANCELLED, QUOTE_UPLOADED,
   QUOTE_DELETED, CHARGE_GENERATED }
```

### 12.6 Shape de Resultados (Tally)

```json
{
  "round": 1,
  "status": "VOTING",
  "total_apartments": 10,
  "total_votes": 7,
  "participation_pct": 70.0,
  "winner_quote_id": null,
  "is_tied": false,
  "is_early_finalizable": true,
  "early_finalize_reason": "MATHEMATICALLY_DECIDED",
  "tallies": [
    {
      "quote_id": "q-...",
      "provider_name": "Acme Portones",
      "amount": 4500,
      "votes": 4,
      "pct": 57.14
    },
    {
      "quote_id": "q-...",
      "provider_name": "Portones SA",
      "amount": 5000,
      "votes": 3,
      "pct": 42.86
    }
  ]
}
```

- `winner_quote_id`: `null` mientras la decisión no esté en `RESOLVED`. En `RESOLVED`, refleja el ganador persistido.
- `tallies`: ordenados por votos desc. El primero es el líder provisional durante VOTING. Siempre presente — `[]` si no hay quotes/votos.
- `participation_pct`: relativo al total de apartamentos del edificio (`totalApartments` lookup).
- `is_early_finalizable` / `early_finalize_reason`: señal derivada (no autoritativa) para que el front habilite el botón "Finalizar ahora" antes de `voting_deadline`. Solo significativa mientras `status === 'VOTING'`; en cualquier otro estado retorna `false` / `null`.
  - `ALL_VOTED`: `total_votes >= total_apartments`. Todos los apartamentos ya votaron (incluso empate cuenta — admin decide cerrar a tiebreak).
  - `MATHEMATICALLY_DECIDED`: `leader_votes - second_best_votes > remaining_voters`. Ningún voto restante puede cambiar el ganador.
  - `null`: race todavía abierta, o no hay votos, o status no es VOTING.
  - **Flag es advisory**. `FinalizeDecision` re-computa el tally bajo `pg_advisory_xact_lock` — fuente de verdad al presionar el botón.
- **Misma shape embebida en `GET /decisions/:id`** bajo el campo `tally`. Front puede renderizar el widget de resultados desde cualquiera de los dos endpoints con la misma lógica.

### 12.7 Integración con Facturación

El módulo de Decisiones no escribe directamente en `invoices`. Delega a dos adapters (**puertos**) que implementan la interfaz `ChargeGenerator`:

| Adapter | Tipo de cargo | Implementación en producción |
|---------|--------------|------------------------------|
| `InvoiceChargeGenerator` | `INVOICE` | Crea un recibo individual vía `invoiceRepo.create()` con `tag=NORMAL` |
| `AssessmentChargeGenerator` | `ASSESSMENT` | Crea un batch de recibos via `invoiceRepo.createBatch()` — prorrateo equitativo |

Ambos adapters retornan `{ type, id }` que queda persistido en `decision.resulting_type` y `decision.resulting_id`, permitiendo trazabilidad desde la decisión al cargo generado.

**Nota V1**: la trazabilidad inversa (desde el invoice/assessment encontrar la decisión origen) está planificada como `source_decision_id` para V1.5.

### 12.8 Almacenamiento de Archivos

- **Bucket**: `issue-files` (separado de `payment-proofs`)
- **Flujo two-step** (mismo patrón que payment proofs):
  1. `POST /decisions/:id/file-url { filename, mime_type }` → obtiene URL firmada de Supabase Storage
  2. Cliente sube el archivo directamente a Supabase Storage con la URL firmada
  3. `POST /decisions/:id/quotes { ..., file_url: "<url>" }` → registra la cotización con la URL ya subida
- **Tipos aceptados**: PDF recomendado; el backend no valida MIME type en V1.
- **Un archivo por cotización** (múltiples archivos planificados para V2).

### 12.9 RLS

Las políticas de Row Level Security para el módulo Decisions están definidas en:
- `supabase/migrations/XXXX_decisions_rls.sql`

Resumen de políticas:
- **`decisions`**: Board/Admin ven todas las decisiones de sus edificios. Residentes ven solo decisiones de edificios donde son miembros.
- **`decision_quotes`**: lectura pública dentro del edificio; write restringido a upload propio + admin.
- **`decision_votes`**: lectura pública dentro del edificio; write 1 voto por apartamento por ronda (enforce DB-level via UNIQUE constraint).
- **`decision_audit_log`**: read-only para Admin/Board. Sin acceso a residents.

### 12.10 Enumeraciones del Módulo

**DecisionStatus**:
| Valor | Descripción |
|-------|-------------|
| `RECEPTION` | Recepción de cotizaciones activa |
| `VOTING` | Votación activa |
| `RESOLVED` | Decisión tomada, hay ganador |
| `TIEBREAK_PENDING` | Empate en 2 rondas, requiere resolución manual |
| `CANCELLED` | Cancelada. Estado terminal |

**AuditEvent**:
| Valor | Disparador |
|-------|------------|
| `CREATED` | Decisión creada |
| `PHASE_ADVANCED` | RECEPTION → VOTING |
| `FINALIZED` | VOTING → RESOLVED |
| `TIEBREAK_OPENED` | Empate ronda 1 → abre ronda 2 |
| `WINNER_SET_MANUAL` | Board/Admin elige ganador manualmente |
| `CANCELLED` | Decisión cancelada |
| `QUOTE_UPLOADED` | Nueva cotización subida |
| `QUOTE_DELETED` | Cotización eliminada (soft-delete) |
| `CHARGE_GENERATED` | INVOICE o ASSESSMENT creado |

**ResultingType** (tipo de cargo generado):
| Valor | Descripción |
|-------|-------------|
| `INVOICE` | Recibo individual a una unidad |
| `ASSESSMENT` | Prorrateo a todas las unidades del edificio |

### 12.11 Contrato de Respuesta — DTOs

Los DTOs siguen spec §6.4 con los siguientes puntos concretos:

**`DecisionDTO`**
- `created_by: { id, name } | null` — objeto expandido (join a `profiles`). Es `null` si el profile original fue eliminado (`ON DELETE SET NULL`). Spec original lo marca como non-null; la realidad de la DB obliga a permitir `null`.
- `quote_count: number` — cantidad de cotizaciones activas (excluye soft-deleted). Computado en el repo.
- `is_deadline_passed: boolean` — computado server-side. `true` cuando la fase actual (`RECEPTION` o `VOTING`) tiene deadline vencido; siempre `false` en estados terminales (`RESOLVED`, `CANCELLED`, `TIEBREAK_PENDING`). Autoritativo del servidor para evitar drift de reloj del cliente.
- `photo_url: string | null` — **signed URL** regenerada por request (TTL 900s / 15 min). El cliente no debe cachearla más allá del TTL.

**`QuoteDTO`**
- `uploader: { id, name } | null` — reemplaza el UUID pelado.
- `deleted_by: { id, name } | null` — reemplaza el UUID pelado.
- `file_url: string` — signed URL, TTL 900s. Re-firmada por request.

**`VoteDTO`**
- `voted_by: { id, name } | null` — reemplaza `voted_by_user_id` UUID.

**`AuditEntryDTO`**
- `actor: { id, name } | null` — reemplaza `actor_user_id` UUID.

### 12.12 `POST /decisions/:id/finalize` — Contrato

- **Body**: opcional. Vacío corre el flujo normal. Para override admin/board:
  ```json
  { "force": true, "reason": "Todos los quotes confirmados, no hay razón para esperar" }
  ```
- **Response**: `DecisionDTO` (200). No se devuelve un `outcome` string — el cliente infiere la transición del `status` resultante.
- **Idempotencia** (spec §7.6): si la decisión ya está en estado terminal (`RESOLVED` o `CANCELLED`), devuelve el estado actual con 200 sin mutar ni escribir en audit log. Esto evita errores confusos ante double-clicks o retries post-timeout.
- **`TIEBREAK_PENDING`** no es idempotente: sigue devolviendo `422 DECISION_WRONG_STATUS` porque requiere resolución manual vía `POST /decisions/:id/resolve-tiebreak`.

**Force advance — override del `reception_deadline`** (admin/board)

Por default el flujo `RECEPTION → VOTING` requiere que `reception_deadline` haya pasado (`422 DECISION_DEADLINE_NOT_YET_PASSED`). Cuando el admin sabe que ya están todos los quotes y esperar no agrega valor:

- `POST /decisions/:id/finalize` con body `{ "force": true, "reason": "<texto>" }`.
- `reason` es **obligatorio** cuando `force: true` (400 `VALIDATION_ERROR` si falta o es vacío). Misma rigurosidad que `cancel` / `extend-deadlines`.
- Sigue aplicando la regla §7.6 de mínimo un quote activo. Sin quotes → `422 DECISION_NO_ACTIVE_QUOTES`.
- Audit log (`AuditEvent.PHASE_ADVANCED`) queda con payload:
  ```json
  {
    "from": "RECEPTION",
    "to": "VOTING",
    "forced": true,
    "reason": "<texto>",
    "previous_reception_deadline": "2026-05-12T15:00:00.000Z"
  }
  ```
- Solo tiene efecto en la transición `RECEPTION → VOTING`. En `VOTING → finalize` no existe deadline check — los flags `force`/`reason` son ignorados sin error.

### 12.13 Firma de URLs — `photo_url` + `file_url`

Per spec §7.8 / §233 / §404 el bucket `issue-files` es privado. Los paths guardados en DB no son públicamente accesibles — el backend firma en **cada lectura** con TTL corto.

- **TTL**: 900s (15 min) en `DecisionFileStorageService.getSignedUrl()`.
- **Serialización**: `src/modules/decisions/presentation/serializers.ts` define `serializeDecision` y `serializeQuote`, que reemplazan el path crudo con `https://...` firmado antes de responder.
- **Aplica a**: `GET /decisions`, `GET /decisions/:id`, `POST/GET /decisions/:id/quotes`, `POST /decisions/:id/photo`, y todos los mutativos que devuelven `DecisionDTO` (`/cancel`, `/deadlines`, `/finalize`, `/resolve-tiebreak`).
- **Cliente**: no cachear la URL más del TTL. Re-fetch del recurso antes de abrir el archivo en sesiones largas.

