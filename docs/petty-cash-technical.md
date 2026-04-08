# Caja Chica — Documentacion Tecnica

## 1. Vision General

El modulo de Caja Chica gestiona fondos para gastos menores por edificio. Esta unificado con el sistema de facturacion (billing) mediante el campo `tag` en invoices, permitiendo una vista consolidada de recibos normales y de caja chica.

### Modulos Involucrados
- **petty-cash**: Gestion del fondo y transacciones
- **billing**: Invoices unificados (recibos normales + caja chica), credito por unidad
- **payments**: Aprobacion de pagos con deteccion de sobrepago
- **auth/guards**: Permisos por rol y por edificio

---

## 2. Modelo de Datos

### 2.1 Tablas de Caja Chica

#### `petty_cash_funds` (1 por edificio)
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | UUID PK | Identificador unico |
| `building_id` | UUID FK (UNIQUE) | Edificio al que pertenece |
| `current_balance` | DECIMAL(12,2) | Balance actual del fondo |
| `currency` | VARCHAR | Moneda (default: VES) |
| `updated_at` | TIMESTAMPTZ | Ultima actualizacion |

#### `petty_cash_transactions`
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | UUID PK | Identificador unico |
| `fund_id` | UUID FK | Fondo al que pertenece |
| `type` | VARCHAR CHECK | `INCOME` o `EXPENSE` |
| `amount` | DECIMAL(12,2) | Monto de la transaccion |
| `description` | TEXT | Descripcion del movimiento |
| `category` | VARCHAR | Categoria del gasto |
| `created_by` | UUID FK | Usuario que registro la transaccion |
| `evidence_url` | TEXT | URL del comprobante (opcional) |
| `created_at` | TIMESTAMPTZ | Fecha de creacion |

### 2.2 Invoices (Recibos Unificados)

#### Campos relevantes en `invoices`
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `tag` | VARCHAR(20) | `NORMAL` (recibo comun) o `PETTY_CASH` (gasto de caja chica) |
| `building_id` | UUID FK (nullable) | Edificio (usado en invoices de caja chica) |
| `unit_id` | UUID FK (nullable) | Unidad (usado en recibos normales) |
| `type` | VARCHAR | `EXPENSE`, `DEBT`, `EXTRAORDINARY` |
| `status` | VARCHAR | `PENDING`, `PAID`, `CANCELLED` |

**Constraint**: `CHECK (unit_id IS NOT NULL OR building_id IS NOT NULL)` — al menos uno debe estar presente.

**Indices**:
- `idx_invoices_tag` sobre `tag`
- `idx_invoices_building_id` sobre `building_id`

### 2.3 Credito por Unidad

#### `unit_credit_ledger` (append-only)
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `id` | UUID PK | Identificador unico |
| `unit_id` | UUID FK | Unidad que tiene el credito |
| `amount` | DECIMAL(12,2) | Monto (positivo = credito, negativo = consumo futuro) |
| `reason` | TEXT | Razon del credito |
| `reference_type` | VARCHAR(50) | Tipo de referencia (ej: `payment`) |
| `reference_id` | UUID | ID de la referencia |
| `created_at` | TIMESTAMPTZ | Fecha de creacion |

**Constraint**: `CHECK (amount != 0)`

#### `unit_credit_balance` (VIEW)
```sql
SELECT unit_id, COALESCE(SUM(amount), 0) AS balance
FROM unit_credit_ledger
GROUP BY unit_id
```

---

## 3. Arquitectura de Modulos

```
src/modules/petty-cash/
├── domain/
│   ├── entities/
│   │   ├── PettyCashFund.ts        -- Entidad con registerExpensePartial()
│   │   └── PettyCashTransaction.ts -- Entidad de transaccion
│   └── repositories/
│       └── PettyCashRepository.ts  -- Interface del repositorio
├── application/
│   └── use-cases/
│       ├── GetPettyCashBalance.ts
│       ├── GetPettyCashHistory.ts
│       ├── RegisterPettyCashIncome.ts
│       └── RegisterPettyCashExpense.ts  -- Genera invoice con tag=PETTY_CASH
├── infrastructure/
│   └── repositories/
│       └── SupabasePettyCashRepository.ts
└── presentation/
    └── routes.ts                   -- Con requireBuildingAccess por ruta

src/modules/billing/
├── domain/
│   ├── entities/
│   │   ├── Invoice.ts              -- tag, building_id, nullable unit_id
│   │   ├── CreditLedgerEntry.ts    -- Entidad de credito
│   │   └── PaymentAllocation.ts
│   └── repository.ts              -- IInvoiceRepository + ICreditLedgerRepository
├── application/
│   └── use-cases/
│       ├── GetAllInvoices.ts       -- Soporta filtro por tag
│       ├── GetUnitInvoices.ts      -- Soporta filtro por tag
│       ├── GetUnitCredit.ts        -- Balance + historial de credito
│       └── ...
└── infrastructure/
    └── repositories/
        ├── SupabaseInvoiceRepository.ts       -- OR filter para building_id
        └── SupabaseCreditLedgerRepository.ts  -- Nuevo
```

---

## 4. Endpoints

### 4.1 Rutas APK (`/api/v1/app/`)
**Exclusivas para Residentes.** Solo operaciones de lectura y reporte de pagos. Junta y Admin no usan la APK — operan exclusivamente desde el Web Admin.

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/users/me` | Mi perfil |
| PATCH | `/users/me` | Actualizar mi perfil |
| GET | `/petty-cash/funds/:buildingId` | Balance actual del fondo (lectura) |
| GET | `/petty-cash/funds/:buildingId/transactions` | Historial de transacciones (lectura) |
| GET | `/billing/units/:id/balance` | Balance de deuda de mi unidad |
| GET | `/billing/units/:id/invoices?tag=` | Mis invoices (filtrable por tag) |
| GET | `/billing/units/:id/credit` | Mi credito/saldo a favor |
| GET | `/payments` | Mi historial de pagos |
| GET | `/payments/summary` | Mi resumen de solvencia |
| GET | `/payments/:id` | Detalle de un pago |
| POST | `/payments` | Reportar pago con comprobante |

### 4.2 Rutas Admin (`/api/v1/admin/`)
Solo accesibles por Board y Admin. Aplica `requireRole([ADMIN, BOARD])` a nivel de grupo. **Todas las operaciones administrativas se concentran aqui**.

**Caja Chica (RESTful)**:

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/petty-cash/funds/:buildingId` | Balance actual del fondo |
| GET | `/petty-cash/funds/:buildingId/transactions` | Historial de transacciones |
| POST | `/petty-cash/funds/:buildingId/transactions` | Crear transaccion (type=INCOME o EXPENSE) |
| GET | `/petty-cash/funds/:buildingId/assessments` | Preview cobro excedente a unidades |
| POST | `/petty-cash/funds/:buildingId/assessments` | Generar facturas a unidades por excedente |

**Facturacion**:

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/billing/invoices?tag=` | Listar todos los invoices (filtrable por tag) |
| POST | `/billing/debt` | Cargar deuda manual a una unidad |
| POST | `/billing/invoices/preview` | Pre-visualizar facturas desde Excel |
| POST | `/billing/invoices/confirm` | Confirmar carga masiva desde Excel |
| GET | `/billing/units/:id/balance` | Balance de deuda |
| GET | `/billing/units/:id/invoices?tag=` | Invoices de unidad |
| GET | `/billing/units/:id/credit` | Credito de unidad |

**Pagos**:

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| GET | `/payments/admin/payments` | Listar todos los pagos (con filtros) |
| PATCH | `/payments/admin/payments/:id` | Aprobar o rechazar un pago |

**Edificios y Usuarios**:

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| POST | `/buildings` | Crear edificio |
| PATCH | `/buildings/:id` | Actualizar edificio |
| POST | `/buildings/:id/units` | Crear unidad |
| POST | `/buildings/:id/units/batch` | Crear unidades en lote |
| GET | `/users` | Listar usuarios |
| PATCH | `/users/:id` | Actualizar usuario |
| POST | `/users/:id/approve` | Aprobar usuario |
| POST | `/users` | Crear usuario |
| DELETE | `/users/:id` | Eliminar usuario |

### 4.4 Filtro por Tag
El query param `tag` es opcional en los endpoints de invoices:
- Sin `tag`: retorna TODOS los invoices (backward compatible)
- `tag=NORMAL`: solo recibos de condominio (deuda, extraordinarios)
- `tag=PETTY_CASH`: solo gastos de caja chica

---

## 5. Flujos Tecnicos

### 5.1 Registrar Gasto de Caja Chica

```
Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/transactions
  Content-Type: multipart/form-data
  {
    type: "EXPENSE", amount, description, category,
    evidence_image? (file)
  }

1. requireRole([ADMIN, BOARD]) → verifica rol
2. requireBuildingAccess(buildingId) → verifica membresia
3. RegisterPettyCashExpense.execute():
   a. Obtener o crear PettyCashFund del edificio
   b. fund.registerExpensePartial(amount) → { deducted, overage }
      - Si fondo=30 y gasto=50: deducted=30, overage=20, balance→0
      - Si fondo=50 y gasto=30: deducted=30, overage=0, balance→20
   c. Crear PettyCashTransaction (type=EXPENSE)
   d. Si evidence_image → subir a Supabase Storage
   e. Crear Invoice:
      - building_id = buildingId (NO unit_id)
      - tag = PETTY_CASH
      - type = EXPENSE
      - status = PAID (es un registro, no una deuda)
      - description = "[CATEGORY] description"
      - amount = deducted
   f. Si overage > 0 → crear segundo Invoice por el monto excedente
   g. Guardar fondo actualizado
```

### 5.2 Registrar Ingreso a Caja Chica

```
Board/Admin → POST /api/v1/admin/petty-cash/funds/{buildingId}/transactions
  { type: "INCOME", amount, description }

1. requireRole + requireBuildingAccess
2. RegisterPettyCashIncome.execute():
   a. Obtener o crear PettyCashFund
   b. fund.addIncome(amount) → balance aumenta
   c. Crear PettyCashTransaction (type=INCOME, category=OTHER)
   d. Guardar fondo actualizado
```

### 5.3 Deteccion de Sobrepago → Credito por Unidad

```
Admin/Board aprueba pago → PATCH /payments/admin/payments/:id

ApprovePayment.approve():
  1. Verificar pago existe y esta PENDING
  2. Verificar aprobador tiene permisos
  3. Cambiar status a APPROVED
  4. Para cada allocation del pago:
     a. DB trigger actualiza invoice.paid_amount automaticamente
     b. Re-leer invoice para obtener paid_amount actualizado
     c. Si paid_amount > amount (sobrepago detectado):
        - surplus = paid_amount - amount
        - Solo si invoice tiene unit_id (no aplica a building-level)
        - Crear CreditLedgerEntry:
            unit_id = invoice.unit_id
            amount = surplus
            reason = "Overpayment on invoice {id}"
            reference_type = "payment"
            reference_id = payment.id
        - Guardar via creditLedgerRepo.addCredit()
```

### 5.4 Consultar Credito de una Unidad

```
GET /api/v1/app/billing/units/:id/credit

GetUnitCredit.execute(unitId):
  1. creditLedgerRepo.getBalanceForUnit(unitId) → number
  2. creditLedgerRepo.getEntriesForUnit(unitId) → CreditLedgerEntry[]
  3. Retorna { balance, history }

Ejemplo respuesta:
{
  "balance": 10.00,
  "history": [
    {
      "id": "uuid",
      "unit_id": "uuid",
      "amount": 10.00,
      "reason": "Overpayment on invoice abc-123",
      "reference_type": "payment",
      "reference_id": "uuid",
      "created_at": "2026-04-08T..."
    }
  ]
}
```

### 5.5 Consultar Recibos Unificados

```
GET /api/v1/admin/billing/invoices?tag=PETTY_CASH&building_id=xxx

GetAllInvoices.execute(filters):
  1. Si tag presente → filtrar por tag
  2. Si building_id presente → dos queries paralelas + merge:
     - Query 1: invoices.building_id = X (caja chica, building-level)
     - Query 2: units.building_id = X via inner join (recibos normales)
     - Deduplicar por id
  3. Retorna lista unificada con tag visible en cada invoice
```

### 5.6 Preview y Generacion de Assessments (Cobro a Unidades)

```
Preview:
GET /api/v1/admin/petty-cash/funds/{buildingId}/assessments

PreviewAssessments.execute(buildingId):
  1. Obtener fondo y todas sus transacciones
  2. Calcular:
     - total_expenses = SUM(transactions type=EXPENSE)
     - total_income = SUM(transactions type=INCOME)
     - fund_balance = fund.current_balance
     - total_overage = MAX(0, expenses - income - balance)
  3. Obtener invoices PETTY_CASH con unit_id (ya cobrados a unidades)
     - already_assessed = SUM(esos invoices)
  4. pending_to_assess = MAX(0, overage - already_assessed)
  5. Obtener unidades del edificio
  6. per_unit = pending_to_assess / cantidad_unidades
  7. Retorna desglose completo

Ejemplo:
  Ingresos: $16,000 | Gastos: $23,000 | Balance: $0
  Overage: 23,000 - 16,000 - 0 = $7,000
  Ya cobrado: $0 | Pendiente: $7,000
  Unidades: 10 → $700 por unidad
```

```
Generar:
POST /api/v1/admin/petty-cash/funds/{buildingId}/assessments

GenerateAssessments.execute(buildingId):
  1. Ejecuta PreviewAssessments para calcular montos
  2. Valida: pending_to_assess > 0 (sino → 400)
  3. Valida: units.length > 0 (sino → 400)
  4. Por cada unidad, crea Invoice:
     - unit_id = unidad, building_id = edificio
     - tag = PETTY_CASH, type = EXPENSE
     - status = PENDING
     - description = "Cuota reposicion caja chica - YYYY-MM"
     - amount = pending_to_assess / cantidad_unidades
  5. Guarda todos los invoices via createBatch
  6. Retorna lista con invoice_id por unidad
```

---

## 6. Permisos y Seguridad

### 6.1 Guards (src/core/presentation/guards.ts)

| Guard | Funcion |
|-------|---------|
| `requireRole(roles[])` | Valida JWT, carga perfil, verifica rol. Retorna 401/403. |
| `requireBuildingAccess(getBuildingId)` | Verifica membresia en building_members. Admin bypasses. Board debe ser miembro. |

### 6.2 Matriz de Permisos — Caja Chica

| Accion | Admin | Board (su edificio) | Board (otro edificio) | Resident |
|--------|-------|--------------------|-----------------------|----------|
| Ver balance | Si | Si | No (403) | Si (lectura, APK) |
| Ver historial | Si | Si | No (403) | Si (lectura, APK) |
| Registrar ingreso | Si | Si | No (403) | No (403) |
| Registrar gasto | Si | Si | No (403) | No (403) |
| Preview assessments | Si | Si | No (403) | No (403) |
| Generar assessments | Si | Si | No (403) | No (403) |
| Ver recibos (tag filter) | Si | Si | No (403) | Solo su unidad (APK) |
| Ver credito unidad | Si | Si | No (403) | Solo su unidad (APK) |

### 6.3 RLS (Row Level Security)

- **petty_cash_funds**: Board SELECT por building_members, Admin SELECT all
- **petty_cash_transactions**: Board SELECT via fund→building join, Admin SELECT all
- **unit_credit_ledger**: Resident SELECT su unidad, Board SELECT unidades de su edificio, Admin SELECT all
- Escritura: solo via service_role (backend bypasses RLS)

---

## 7. Enumeraciones

### InvoiceTag
| Valor | Descripcion |
|-------|-------------|
| `NORMAL` | Recibo de condominio (deuda, extraordinario) |
| `PETTY_CASH` | Gasto de caja chica |

### PettyCashTransactionType
| Valor | Descripcion |
|-------|-------------|
| `INCOME` | Ingreso/reposicion del fondo |
| `EXPENSE` | Egreso/gasto del fondo |

### PettyCashCategory
| Valor | Descripcion |
|-------|-------------|
| `REPAIR` | Reparaciones |
| `CLEANING` | Limpieza |
| `EMERGENCY` | Emergencias |
| `OFFICE` | Material de oficina |
| `UTILITIES` | Servicios publicos |
| `OTHER` | Otros gastos |

---

## 8. Migraciones

| Archivo | Descripcion |
|---------|-------------|
| `20260408100000_add_invoice_tag_and_building_id.sql` | tag + building_id en invoices, unit_id nullable, CHECK constraint, indices |
| `20260408110000_create_credit_ledger.sql` | Tabla unit_credit_ledger + vista unit_credit_balance |
| `20260408120000_credit_ledger_rls.sql` | Politicas RLS para credito (resident, board, admin) |
| `20260408130000_petty_cash_rls_policies.sql` | Politicas RLS para caja chica (antes no existian) |
