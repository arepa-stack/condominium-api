# Condominio API Server — Documentación Funcional

> **Última actualización**: 2026-04-17 — Refleja el estado post-PR Phase 2 de separación de roles (`feat/app-role-phase-2`).
> Cambios destacados de esta iteración: nueva columna `profiles.app_role` (`admin` | `user`) como fuente de verdad del rol **global**; `building_members.role` es la fuente per-edificio (sólo `board` hoy, con CHECK constraint); `profile_units` implica "resident" en esos edificios. La función SQL `get_my_role()` fue reescrita para derivar del nuevo modelo manteniendo su contrato de retorno (`admin|board|resident`) — las RLS policies existentes siguen funcionando sin cambios. El backend TypeScript lee `app_role` y `building_members` directamente; los guards (`requireRole`, `requireBuildingAccess`) y use cases ahora resuelven roles desde este modelo. `profiles.role` queda como columna legacy (se drop en Phase 4). La respuesta de `/auth/login` y `/auth/register` ahora incluye `app_role` junto al `role` legacy.
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
| `role` | TEXT | Rol global: `admin`, `board`, `resident` |
| `status` | TEXT | Estado: `active`, `pending`, `inactive`, `rejected` |

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

#### Caja Chica — Fondo (`petty_cash_funds`)
Fondo de caja chica por edificio. Cada edificio tiene un único fondo.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `building_id` | UUID (UNIQUE) | Edificio al que pertenece |
| `current_balance` | DECIMAL(12,2) | Balance actual del fondo |
| `currency` | VARCHAR | Moneda (default: VES) |
| `updated_at` | TIMESTAMPTZ | Última actualización |

#### Caja Chica — Transacción (`petty_cash_transactions`)
Movimientos de la caja chica (ingresos y egresos).

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `fund_id` | UUID | Fondo al que pertenece |
| `type` | VARCHAR | Tipo: `INCOME` o `EXPENSE` |
| `amount` | DECIMAL(12,2) | Monto de la transacción |
| `description` | TEXT | Descripción del movimiento |
| `category` | VARCHAR | Categoría: `REPAIR`, `CLEANING`, `EMERGENCY`, `OFFICE`, `UTILITIES`, `OTHER` |
| `created_by` | UUID | Usuario que registró la transacción |
| `evidence_url` | TEXT | URL de evidencia/comprobante (opcional) |
| `created_at` | TIMESTAMPTZ | Fecha de creación |

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
| `/petty-cash/funds/:buildingId` | GET | App - Petty Cash | Balance caja chica (lectura) |
| `/petty-cash/funds/:buildingId/transactions` | GET | App - Petty Cash | Historial de movimientos (lectura) |
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
| `/billing/invoices?tag=&page=&limit=` | GET | Lista **paginada** de invoices. Query params: `page` (default `1`), `limit` (default `10`), `unit_id`, `building_id`, `status`, `period`, `year`, `user_id`, `tag` (NORMAL / PETTY_CASH). Response: `{ data: AdminInvoice[], metadata: { total, page, limit, totalPages, hasNextPage, hasPrevPage } }`. |
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
| `/petty-cash/funds/:buildingId` | GET | Balance actual del fondo |
| `/petty-cash/funds/:buildingId/transactions` | GET | Historial de transacciones (filtros: `type`, `category`, `page`, `limit`) |
| `/petty-cash/funds/:buildingId/transactions` | POST | Crear transacción. `type` en body: `INCOME` (reposición) o `EXPENSE` (gasto, genera invoice PETTY_CASH). `category` y `evidence_image` solo para EXPENSE. |
| `/petty-cash/funds/:buildingId/assessments` | GET | Preview: muestra excedente del fondo (gastos - ingresos), lo ya cobrado a unidades, lo pendiente y cuánto le toca a cada unidad |
| `/petty-cash/funds/:buildingId/assessments` | POST | Generar facturas PENDING a cada unidad del edificio por el excedente pendiente. Retorna 400 si no hay excedente. |
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

### 7.5 Gestión de Caja Chica (unificada con recibos)
```
Registrar Gasto:
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/transactions
   Body: { type: "EXPENSE", amount, description, category, evidence_image? }
2. El sistema descuenta del fondo lo que hay disponible:
   - Si fondo=500, gasto=80 → descuenta 80, fondo queda en 420
   - Si fondo=30, gasto=80 → descuenta 30, fondo queda en 0
3. Se genera automáticamente un invoice con tag=PETTY_CASH a nivel de edificio
   - building_id = edificio, unit_id = null
   - type = EXPENSE, status = PAID
   - description = "[CATEGORÍA] descripción del gasto"
4. Si hubo excedente (gasto > fondo), se genera invoice adicional por el monto excedente

Registrar Ingreso (reposición):
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/transactions
   Body: { type: "INCOME", amount, description }
2. Balance del fondo aumenta inmediatamente

Consultas:
- Balance en tiempo real → GET /petty-cash/funds/{buildingId}
- Historial de movimientos → GET /petty-cash/funds/{buildingId}/transactions
- Recibos de caja chica → GET /billing/invoices?tag=PETTY_CASH
- Todos los recibos unificados → GET /billing/invoices (sin filtro de tag)
```

### 7.6 Cobro de Excedente a Unidades (Assessments)
```
Cuando los gastos de caja chica superan los ingresos, la Junta puede generar
facturas a las unidades para cubrir el excedente.

Preview:
1. Board/Admin → GET /api/v1/admin/petty-cash/funds/{buildingId}/assessments
2. El sistema calcula (toda la aritmética en centavos integer para
   evitar drift de IEEE-754):
   - total_expenses: suma de todas las transacciones EXPENSE
   - total_income: suma de todas las transacciones INCOME
   - fund_balance: balance actual del fondo
   - total_overage: gastos - ingresos - balance = excedente real
   - already_assessed: lo ya cobrado a unidades (invoices PETTY_CASH con unit_id)
   - pending_to_assess: excedente - ya cobrado = pendiente por cobrar
     (si el residuo es menor a 1 centavo, se clampea a 0 — es ruido
     contable de invoices legacy almacenadas como float)
   - units: lista de unidades con el monto que le corresponde a cada
     una. La distribución es justa al centavo: las primeras
     `remainder` unidades reciben 1 centavo extra, de modo que la
     sumatoria de unit amounts coincide exactamente con pending_to_assess.

Generar facturas:
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/assessments
2. Se crea un invoice PENDING por cada unidad del edificio:
   - tag = PETTY_CASH, type = EXPENSE, status = PENDING
   - amount = el monto calculado por el preview (distribución justa al centavo)
   - description = "Cuota reposición caja chica - YYYY-MM"
3. Retorna 400 si:
   - no hay excedente pendiente (NO_PENDING_OVERAGE)
   - no hay unidades en el edificio (NO_UNITS)
   - el pendiente no alcanza para dar al menos 1 centavo a cada
     unidad (AMOUNT_TOO_SMALL_TO_DISTRIBUTE) — previene emitir
     facturas de $0 o concentrar el residuo en una sola unidad
4. Los invoices generados aparecen filtrados con tag=PETTY_CASH
```

### 7.7 Crédito / Saldo a Favor por Unidad

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

### 7.8 Reversa de Pagos

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

### 7.9 Transparencia de Caja Chica

```
1. Board/Admin → GET /petty-cash/funds/:buildingId/transparency?period=YYYY-MM
   - period es query param REQUERIDO. Sin él → 422.

2. El use case GetPettyCashTransparency:
   a. Carga las units del edificio (todas aparecen en el response, tengan o no invoice).
   b. Carga las invoices PETTY_CASH del edificio filtradas por el período solicitado.
   c. Indexa las invoices por unit_id en un Map (O(1) lookup).
      - Invoices CANCELLED se EXCLUYEN del indexado — no cuentan en los totales.
      - Si una unit tiene múltiples invoices del mismo período, la última en el array gana
        (TODO: agregar UNIQUE constraint a nivel DB cuando el modelo lo garantice).

3. Por cada unit:
   a. Si tiene invoice activa: expected_amount = invoice.amount,
      covered_amount = min(invoice.paid_amount, invoice.amount)  // capado a la cuota
      status = invoice.status (PENDING | PARTIAL | PAID — CANCELLED ya está filtrado).
   b. Si NO tiene invoice (o estaba CANCELLED): expected=0, covered=0, status=PENDING.

4. El capado de covered_amount a expected_amount es intencional: un residente que
   pagó 100 contra una cuota de 80 NO debe inflar el collection_percentage del grupo.
   Su excedente (20) va al credit ledger por el canal B (unallocated surplus),
   no al total de caja chica.

5. Response:
   {
     building_id,
     period,
     total_to_collect: sum de expected_amount,
     total_collected: sum de covered_amount (todas capadas a sus respectivas cuotas),
     collection_percentage: (total_collected / total_to_collect) * 100 (redondeado 2 decimales),
     units: [
       { unit_id, unit_name, expected_amount, covered_amount, status }
     ]
   }
```

**Breaking change**: el endpoint requería antes `?period=` como opcional (y se ignoraba, agregando todas las invoices históricas del edificio — bug). Ahora es estrictamente requerido. El frontend del Web Admin debe pasar el período actual explícitamente.

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
invoices → unit_id (nullable), building_id (nullable), tag (NORMAL|PETTY_CASH)
payment_allocations → payment_id, invoice_id
unit_credit_ledger → unit_id (saldo a favor por sobrepago)
unit_credit_balance → VIEW sobre unit_credit_ledger
petty_cash_funds → building_id (UNIQUE, 1 por edificio)
petty_cash_transactions → fund_id

Relación caja chica ↔ recibos:
  POST /petty-cash/funds/:buildingId/transactions (EXPENSE)
    → crea invoice (tag=PETTY_CASH, building_id, unit_id=null, status=PAID)

Relación caja chica → cobro a unidades:
  POST /petty-cash/funds/:buildingId/assessments
    → crea invoices (tag=PETTY_CASH, unit_id, status=PENDING) por unidad
  
Relación pagos → crédito:
  Aprobación de pago con sobrepago → crea entrada en unit_credit_ledger

Directorio de junta:
  board_members_directory → VIEW sobre building_members + profiles + profile_units + units
    (DISTINCT ON por member_id, pick la unidad más reciente)
```

---

## 11. Endpoint de Salud

| Endpoint | Método | Autenticación | Descripción |
|----------|--------|---------------|-------------|
| `/health` | GET | ❌ Pública | Retorna `{ status: "ok", timestamp: "..." }` para monitoreo |
| `/swagger` | GET | ❌ Pública | Documentación interactiva de la API (OpenAPI 3.0) |
