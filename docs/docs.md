# Condominio API Server — Documentación Funcional

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

El sistema tiene **3 roles** con jerarquía de permisos clara:

### 2.1 Admin (`admin`)
- **Descripción**: Administrador general de la plataforma.
- **Alcance**: Acceso total a todos los edificios y todas las operaciones.
- **Permisos**:
  - CRUD completo de edificios y unidades
  - Crear, actualizar y eliminar usuarios
  - Cambiar roles de usuarios
  - Ver y gestionar todos los pagos de todos los edificios
  - Aprobar o rechazar pagos
  - Cargar deuda (facturas/invoices) a unidades
  - Carga masiva de facturas desde Excel
  - Gestionar caja chica (ingresos y egresos)
  - Ver balances y crédito de cualquier unidad
  - Ver recibos unificados (normales + caja chica) con filtro por etiqueta
- **Acceso**: Solo Panel Web Admin. No usa la APK.

### 2.2 Board / Junta (`board`)
- **Descripción**: Miembro de la junta de condominio de un edificio específico.
- **Alcance**: Acceso limitado al(los) edificio(s) donde tiene el rol de junta.
- **Permisos desde Web Admin** (operaciones administrativas):
  - Aprobar usuarios de su edificio
  - Ver y gestionar usuarios de su edificio
  - Ver todos los pagos de su edificio y aprobar/rechazar
  - Cargar deuda a unidades de su edificio
  - Carga masiva de facturas desde Excel para su edificio
  - Gestionar caja chica de su edificio (registrar ingresos y gastos)
  - Ver recibos unificados (normales + caja chica) con filtro por etiqueta
  - Ver crédito/saldo a favor de unidades de su edificio
- **Restricción**: Solo opera sobre edificios donde tiene membresía con rol `board` en la tabla `building_members`. El sistema valida membresía por edificio en cada operación mediante el guard `requireBuildingAccess`.
- **Acceso**: Solo Panel Web Admin. No usa la APK.

### 2.3 Resident / Residente (`resident`)
- **Descripción**: Residente de una o más unidades.
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
  - **No puede** acceder al Panel Web Admin
- **Acceso**: Solo Aplicación Móvil (APK).

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
| `status` | TEXT | Estado: `PENDING`, `APPROVED`, `REJECTED` |
| `notes` | TEXT | Notas adicionales (opcional) |
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
| `paid_amount` | NUMERIC | Monto pagado hasta ahora (actualizado por trigger de BD) |
| `period` | TEXT | Período en formato `YYYY-MM` (ej: "2026-01") |
| `description` | TEXT | Descripción de la factura. En caja chica: `"[CATEGORÍA] descripción"` |
| `receipt_number` | TEXT | Número de recibo (opcional) |
| `status` | TEXT | Estado: `PENDING`, `PAID`, `CANCELLED` |
| `due_date` | DATE | Fecha de vencimiento (opcional) |

**Constraints**: `CHECK (unit_id IS NOT NULL OR building_id IS NOT NULL)` — al menos uno debe estar presente. Esto permite invoices a nivel de unidad (recibos normales) o a nivel de edificio (gastos de caja chica).

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
Registro append-only de movimientos de crédito/saldo a favor por unidad. Cuando un residente paga de más, el excedente se acumula aquí.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | UUID | Identificador único |
| `unit_id` | UUID | Unidad que tiene el crédito |
| `amount` | DECIMAL(12,2) | Monto (positivo = crédito acumulado, negativo = consumo futuro). CHECK: != 0 |
| `reason` | TEXT | Razón del crédito (ej: "Overpayment on invoice abc-123") |
| `reference_type` | VARCHAR(50) | Tipo de referencia (ej: `payment`) |
| `reference_id` | UUID | ID de la referencia |
| `created_at` | TIMESTAMPTZ | Fecha de creación |

#### Crédito por Unidad — Balance (`unit_credit_balance`)
Vista materializada que calcula el saldo a favor de cada unidad.

```sql
SELECT unit_id, COALESCE(SUM(amount), 0) AS balance
FROM unit_credit_ledger GROUP BY unit_id
```

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
| `/billing/units/:id/balance` | GET | App - Billing | Balance de deuda de mi unidad |
| `/billing/units/:id/invoices?tag=` | GET | App - Billing | Mis invoices (filtrable por tag) |
| `/billing/units/:id/credit` | GET | App - Billing | Mi crédito/saldo a favor |
| `/payments` | GET | App - Payments | Mi historial de pagos |
| `/payments/summary` | GET | App - Payments | Mi resumen de solvencia |
| `/payments/:id` | GET | App - Payments | Detalle de un pago |
| `/payments` | POST | App - Payments | Reportar pago con comprobante |
| `/petty-cash/funds/:buildingId` | GET | App - Petty Cash | Balance caja chica (lectura) |
| `/petty-cash/funds/:buildingId/transactions` | GET | App - Petty Cash | Historial de movimientos (lectura) |

#### Rutas Web Admin — `/api/v1/admin/`
**Exclusivas para Board y Admin.** Si un Resident intenta acceder, recibe 403. Toda la gestión administrativa se concentra aquí.

**Facturación (Admin - Billing)**:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/billing/invoices?tag=` | GET | Todos los invoices (filtrable por tag: NORMAL, PETTY_CASH) |
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

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/payments` | GET | Historial de pagos |
| `/payments/summary` | GET | Resumen de solvencia |
| `/payments/:id` | GET | Detalle de un pago |
| `/payments` | POST | Reportar pago |
| `/payments/admin/payments` | GET | Listar todos los pagos (filtros: `building_id`, `status`, `year`, `unit_id`) |
| `/payments/admin/payments/:id` | PATCH | Aprobar o rechazar un pago |

**Caja Chica (Admin - Petty Cash)** — RESTful, recurso `funds` con sub-recursos `transactions` y `assessments`:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/petty-cash/funds/:buildingId` | GET | Balance actual del fondo |
| `/petty-cash/funds/:buildingId/transactions` | GET | Historial de transacciones (filtros: `type`, `category`, `page`, `limit`) |
| `/petty-cash/funds/:buildingId/transactions` | POST | Crear transacción. `type` en body: `INCOME` (reposición) o `EXPENSE` (gasto, genera invoice PETTY_CASH). `category` y `evidence_image` solo para EXPENSE. |
| `/petty-cash/funds/:buildingId/assessments` | GET | Preview: muestra excedente del fondo (gastos - ingresos), lo ya cobrado a unidades, lo pendiente y cuánto le toca a cada unidad |
| `/petty-cash/funds/:buildingId/assessments` | POST | Generar facturas PENDING a cada unidad del edificio por el excedente pendiente. Retorna 400 si no hay excedente. |

**Edificios (Admin - Buildings)**:

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/buildings` | POST | Crear edificio |
| `/buildings/:id` | PATCH | Actualizar edificio |
| `/buildings/:id/units` | POST | Crear unidad individual |
| `/buildings/:id/units/batch` | POST | Crear unidades en lote |

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
| `REJECTED` | Pago rechazado |

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
```
1. Residente reporta pago → POST /payments (monto, fecha, método, referencia, banco, comprobante)
   - Opcionalmente asigna el pago a facturas específicas (allocations)
2. Pago se crea con estado "PENDING"
3. Admin/Board revisa pagos pendientes → GET /payments/admin/payments?status=PENDING
4. Admin/Board aprueba → PATCH /payments/admin/payments/:id { status: "APPROVED" }
   - El trigger de BD actualiza el paid_amount de las facturas asignadas
   - Si el pago excede el monto de una factura (sobrepago):
     → El excedente se acumula como crédito en unit_credit_ledger
     → Solo aplica a facturas con unit_id (no a building-level)
   - O rechaza → PATCH /payments/admin/payments/:id { status: "REJECTED", notes: "..." }
5. Se registra quién procesó el pago (processed_by, processed_at)
```

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
2. El sistema calcula:
   - total_expenses: suma de todas las transacciones EXPENSE
   - total_income: suma de todas las transacciones INCOME
   - fund_balance: balance actual del fondo
   - total_overage: gastos - ingresos - balance = excedente real
   - already_assessed: lo ya cobrado a unidades (invoices PETTY_CASH con unit_id)
   - pending_to_assess: excedente - ya cobrado = pendiente por cobrar
   - units: lista de unidades con el monto que le corresponde a cada una (split igual)

Generar facturas:
1. Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/assessments
2. Se crea un invoice PENDING por cada unidad del edificio:
   - tag = PETTY_CASH, type = EXPENSE, status = PENDING
   - amount = pending_to_assess / cantidad de unidades
   - description = "Cuota reposición caja chica - YYYY-MM"
3. Retorna 400 si no hay excedente pendiente o no hay unidades
4. Los invoices generados aparecen filtrados con tag=PETTY_CASH
```

### 7.7 Crédito / Saldo a Favor por Unidad
```
Acumulación automática:
1. Residente paga recibo de $40 con $50
2. Board/Admin aprueba el pago
3. Trigger de BD actualiza paid_amount del invoice a $50
4. Sistema detecta sobrepago: $50 - $40 = $10 de excedente
5. Se crea entrada en unit_credit_ledger: amount=$10, reason="Overpayment on invoice X"
6. Saldo a favor de la unidad aumenta en $10

Consulta:
- Residente consulta su crédito → GET /billing/units/:id/credit
- Retorna: { balance: 10.00, history: [...] }

Nota: El consumo del crédito (usar saldo a favor para pagar recibos futuros)
está planificado para una futura actualización.
```

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
2. **Nivel de Negocio**: Los Use Cases verifican el rol del usuario que ejecuta la acción.
3. **Nivel de Base de Datos**: Row Level Security (RLS) en Supabase como capa adicional de seguridad.

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
```

---

## 11. Endpoint de Salud

| Endpoint | Método | Autenticación | Descripción |
|----------|--------|---------------|-------------|
| `/health` | GET | ❌ Pública | Retorna `{ status: "ok", timestamp: "..." }` para monitoreo |
| `/swagger` | GET | ❌ Pública | Documentación interactiva de la API (OpenAPI 3.0) |
