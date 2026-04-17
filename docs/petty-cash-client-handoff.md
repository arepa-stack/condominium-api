# Caja Chica — Handoff para clientes (panel admin + APK)

> **Target**: agentes que mantienen el Panel Admin web y la APK móvil.
> **Contexto**: PRs #28 → #29 → #30 reescribieron el módulo de caja chica sobre un modelo **ledger append-only**. Este doc consolida todos los cambios que impactan a los clientes, con los contratos finales.
> **Fuente canónica**: `docs/docs.md` secciones 4.1 (modelo de datos) + 7.5-7.10 (flujos). Este handoff es el resumen accionable.

---

## TL;DR

Tres bloques de trabajo para el panel admin. Uno de referencia para la APK.

1. **Endpoints renombrados**: todo `/transactions` pasó a `/entries`. Shape de request/response cambió de forma sutil.
2. **Assessments ahora son batches con nombre**: el admin manda `{ description, amount, category? }`. Múltiples assessments por período son esperados (`"Ascensor abril"`, `"Agua abril"` son dos llamadas separadas). Transparency se desglosa por batch.
3. **Balance puede ir negativo**: si la junta gasta más de lo que hay, el fondo queda en overdraft. No es un error — es el saldo que el próximo assessment va a cobrar a las units.
4. **APK** (bono): es read-only en este módulo. Solo cambian los paths (`/transactions` → `/entries`) y el shape del historial. El shape de balance también cambia (se va `currency`).

---

## 1. Modelo conceptual — qué leer/escribir

```
petty_cash_fund        (metadata, 1 por building)
    ├── petty_cash_entries       (ledger append-only, tipo + amount firmado)
    │         ↓ (suma)
    │    petty_cash_balance      (VIEW — balance derivado, puede ser negativo)
    │
    └── petty_cash_assessment    (batches nombrados para cobro)
              ↓ (genera)
         invoices (tag=PETTY_CASH, unit_id, assessment_id → batch)
```

**Regla de oro**:
- El balance **no se calcula en el cliente**. El backend lo devuelve ya agregado en `GET /petty-cash/funds/:b`.
- Los movimientos viven en el ledger (`petty_cash_entries`). Cada operación del admin genera **un row**.
- Los assessments se materializan como invoices PENDING por unit. La APK las ve como cualquier otra invoice; el progreso agregado (per-batch) lo sirve el endpoint `/transparency`.

### Tipos de entry (valor de `type` en entries)

| `type` | Cuándo aparece | `amount` | Origen |
|---|---|---|---|
| `income` | Junta registra reposición manual del fondo | **positivo** | Panel admin — `POST /entries` body `{type:"income"}` |
| `expense` | Junta registra un gasto del fondo | **negativo** (el backend convierte el `amount` absoluto que manda el cliente) | Panel admin — `POST /entries` body `{type:"expense"}` |
| `collection` | Un resident pagó una invoice PETTY_CASH | positivo | **Automático** — `ApprovePayment` genera el entry cuando el pago se aprueba |
| `reversal` | Counter-asiento de cualquier otro tipo | negativo-del-original | `POST /entries/:id/reverse` (manual) **o** automático via `ReversePayment` cuando se revierte un pago que había generado un `collection` |

El cliente normalmente solo usa `income` y `expense` en escrituras. `collection` y `reversal` los genera el backend.

---

## 2. Endpoints — contrato final

Base path: `/api/v1/admin/petty-cash` para el panel, `/api/v1/app/petty-cash` para APK. Requieren JWT. El panel también requiere `requireRole([ADMIN, BOARD])` + `requireBuildingAccess` (implicito en el prefijo admin).

### 2.1 `GET /petty-cash/funds/:buildingId`

Balance actual del fondo.

**Response**:
```json
{
  "id": "uuid",
  "building_id": "uuid",
  "current_balance": 420.50,   // puede ser NEGATIVO — mostrar con indicador visual
  "updated_at": "2026-04-19T..."
}
```

⚠️ El campo `currency` **fue eliminado**. Si el cliente lo leía, falla silenciosa.

### 2.2 `GET /petty-cash/funds/:buildingId/entries`

Historial del ledger.

**Query params** (todos opcionales):
- `type` — `income` | `expense` | `collection` | `reversal`
- `category` — `REPAIR` | `CLEANING` | `EMERGENCY` | `OFFICE` | `UTILITIES` | `OTHER` (solo aplica a expense)
- `page` (default 1), `limit` (default 10)

**Response**: `array` plano (no paginado con metadata — ver la nota al final sobre paginación)

```json
[
  {
    "id": "uuid",
    "fund_id": "uuid",
    "type": "income" | "expense" | "collection" | "reversal",
    "amount": 100.0,             // signed: + income/collection, - expense
    "category": "REPAIR" | null,
    "description": "Reposición marzo",
    "evidence_url": "https://..." | null,
    "reference_type": "manual" | "invoice_payment" | "reversal" | null,
    "reference_id": "uuid" | null,
    "created_by": "uuid",
    "created_at": "2026-04-..."
  }
]
```

### 2.3 `POST /petty-cash/funds/:buildingId/entries` — crear entry

Permite solo los dos tipos que la junta origina manualmente: `income` y `expense`.

**Body** (`multipart/form-data`):

| Campo | Tipo | Requerido | Regla |
|---|---|---|---|
| `type` | `'income'` \| `'expense'` | sí | lowercase (antes: `INCOME`/`EXPENSE`) |
| `amount` | number \| string | sí | **siempre positivo** — el backend aplica el signo según `type` |
| `description` | string | sí | no vacía |
| `category` | string | solo para `expense` | `PettyCashCategory` enum; default `OTHER` si no viene |
| `evidence_image` | file | solo para `expense` (opcional) | comprobante del gasto |

**Response**: el entry creado (shape de 2.2).

**Behavior notes**:
- `income` → balance sube.
- `expense` → balance baja y puede quedar negativo (overdraft). No es error.
- No se generan invoices building-level en este flujo (el modelo viejo sí lo hacía).

### 2.4 `POST /petty-cash/funds/:buildingId/entries/:entryId/reverse` — reversa manual

Emite un counter-asiento (type=`reversal`) sobre una entry original.

**Body** (`application/json`):
```json
{
  "reason": "string, 10-500 chars"
}
```

**Response**: el entry de reversal creado (shape de 2.2).

**Errores**:
- `409 INVALID_OPERATION` si el entry original ya es `reversal` (no se reversa una reversal).
- `404 NOT_FOUND` si el entry no existe o no pertenece al fund del `buildingId` (scope check).
- `400 VALIDATION_ERROR` si reason es vacío.
- **Idempotente**: si ya existe una reversal para esa entry, devuelve la existente con 200.

### 2.5 `GET /petty-cash/funds/:buildingId/assessments` — preview

Calcula cuánto se le puede prorratear a las units ahora mismo.

**Response**:
```json
{
  "building_id": "uuid",
  "current_balance": -150.00,
  "total_overage": 150.00,          // max(0, -current_balance)
  "already_assessed": 50.00,        // suma de invoices PETTY_CASH activas con unit_id
  "pending_to_assess": 100.00,      // max(0, overage - already_assessed)
  "units": [
    { "id": "uuid", "name": "4B", "amount": 10.0 },
    // ... cada unit con su cuota si se prorratea el pending ahora
  ]
}
```

### 2.6 `POST /petty-cash/funds/:buildingId/assessments` — generar batch

**🔑 Breaking change grande**. Ahora requiere body.

**Body** (`application/json`):

| Campo | Tipo | Requerido | Regla |
|---|---|---|---|
| `description` | string | sí | Nombre del batch. Aparece literal en cada invoice generada ("Ascensor abril") |
| `amount` | number \| string | sí | Total a prorratear en **este** batch. Puede ser menor que `pending_to_assess` |
| `category` | string | opcional | `PettyCashCategory` para dashboards |

**Response**:
```json
{
  "building_id": "uuid",
  "assessment_id": "uuid",
  "description": "Ascensor abril",
  "total_assessed": 500.00,
  "invoices_created": 10,
  "invoices": [
    { "unit_id": "uuid", "unit_name": "4B", "amount": 50.0, "invoice_id": "uuid" },
    ...
  ]
}
```

**Uso típico** (responde la pregunta de ascensor/agua):

```
POST /assessments { description: "Ascensor abril", amount: 500, category: "REPAIR" }
POST /assessments { description: "Agua abril",     amount: 300, category: "UTILITIES" }
```
Cada unit termina con **dos invoices** en período 2026-04, una por cada batch, con progreso independiente en la transparency.

**Errores**:
- `400 VALIDATION_ERROR` si description vacía, amount ≤ 0, o amount en centavos < units.length (`AMOUNT_TOO_SMALL_TO_DISTRIBUTE`).
- `400 NO_UNITS` si el building no tiene units.

### 2.7 `GET /petty-cash/funds/:buildingId/transparency?period=YYYY-MM`

`period` es **query param obligatorio** (sin él → 422).

**Response**:

```json
{
  "building_id": "uuid",
  "period": "2026-04",

  "assessments": [
    {
      "id": "uuid",
      "description": "Ascensor abril",
      "category": "REPAIR" | null,
      "total_to_collect": 500.00,
      "total_collected": 350.00,
      "collection_percentage": 70.0,
      "units": [
        {
          "unit_id": "uuid",
          "unit_name": "4B",
          "expected_amount": 50.0,
          "covered_amount": 50.0,
          "status": "PAID"    // "PENDING" | "PARTIAL" | "PAID"
        },
        ...
      ]
    },
    {
      "id": "uuid",
      "description": "Agua abril",
      ...
    }
  ],

  // Totales agregados (para dashboards que solo necesitan un número por período)
  "total_to_collect": 800.00,
  "total_collected": 650.00,
  "collection_percentage": 81.25
}
```

**Cambio clave vs. versión anterior**: antes `units[]` estaba en el top-level. Ahora vive **dentro de cada entrada de `assessments[]`**. Los totales globales (`total_to_collect`, `total_collected`, `collection_percentage`) siguen en el top-level — si solo esos se consumían, no rompe.

**Casos edge**:
- Invoices orfanas (sin `assessment_id` — legacy de pre-Phase 2): caen en un batch sintético `{ id: "__legacy__", description: "Sin categorizar (legacy)", category: null }`.
- `covered_amount` está **capado** a `expected_amount` por-invoice — los sobrepagos van al credit ledger, no inflan el `collection_percentage`.
- Invoices `CANCELLED` están **excluidas** de ambos totales.

---

## 3. Breaking changes acumulados (phases 2 + 3)

Tabla comparativa compacta:

| Elemento | Antes | Después |
|---|---|---|
| Endpoint historial/crear movimiento | `/petty-cash/funds/:b/transactions` | **`/petty-cash/funds/:b/entries`** |
| Body `type` en POST | `"INCOME"` \| `"EXPENSE"` | **`"income"`** \| **`"expense"`** (lowercase, mismos valores que el enum del ledger) |
| Balance response | `{ ..., currency, current_balance, ... }` | `{ ..., current_balance (puede ser negativo), updated_at }`. **`currency` eliminado** |
| Balance semántica | Nunca < 0 (el backend clampeaba y generaba invoices fantasma) | **Puede ir negativo** (overdraft explícito) |
| Invoices por egreso | 1-2 invoices `PETTY_CASH, PAID, building-level` por cada egreso | **No se generan** (el egreso vive solo en el ledger) |
| `POST /assessments` body | Sin body | **Requiere** `{ description, amount, category? }` |
| Transparency response | `{ units: [...], total_* }` | `{ assessments: [{...units: [...]}], total_* }`. `units[]` top-level **eliminado** |
| Reverse manual | No existía | **Nuevo endpoint** `POST /entries/:id/reverse` |
| Entries auto-generadas | No existían | Se generan tipos `collection` y `reversal` automáticamente vía ApprovePayment / ReversePayment cuando la invoice es PETTY_CASH con unit_id |

---

## 4. Checklist — Panel Admin web

Las cosas están agrupadas por área de la UI.

### 4.1 Flujos de registro de movimiento (antes "transactions")
- [ ] Renombrar llamadas `POST /funds/:b/transactions` → `POST /funds/:b/entries`.
- [ ] Renombrar `GET /funds/:b/transactions` → `GET /funds/:b/entries`.
- [ ] Actualizar el valor del body field `type`: `"INCOME"` → `"income"`, `"EXPENSE"` → `"expense"`.
- [ ] Si hay toggle "reposición/gasto", el valor interno va lowercase ahora.
- [ ] Al leer el historial, el shape cambió — ahora viene con `reference_type`, `reference_id`, `amount` firmado. Si la UI muestra montos, **usar el signo** para decidir si es ingreso o egreso (o decidir por `type`).

### 4.2 Balance display
- [ ] Eliminar lectura de `balance.currency` (dejó de existir).
- [ ] **Soportar balance negativo**. Mostrar con indicador visual: rojo / flecha abajo / etiqueta "Descubierto $X". No lo trates como error.
- [ ] El campo es `current_balance` (unchanged name), solo la semántica cambió.

### 4.3 Flujo de assessments
- [ ] **Rediseñar el formulario de "generar assessment"**. Antes era un botón sin inputs; ahora el admin completa:
  - `description` (text input, obligatorio): "Ascensor abril", "Agua abril", etc.
  - `category` (dropdown opcional): REPAIR / CLEANING / EMERGENCY / OFFICE / UTILITIES / OTHER.
  - `amount` (number input, obligatorio): el admin elige cuánto prorratear (puede ser ≤ `pending_to_assess`).
- [ ] Listar los batches existentes del período ANTES de crear uno nuevo, para que el admin no duplique (no hay idempotency — crear dos batches iguales crea dos).
- [ ] Al preview (`GET /assessments`) mostrar `pending_to_assess` como **máximo sugerido** para el `amount` del nuevo batch.

### 4.4 Transparency
- [ ] Rediseñar la vista de transparencia para mostrar **progreso por batch**.
  - Por cada entrada de `response.assessments[]`, una tarjeta/fila con: `description`, `category` (chip), `collection_percentage` (barra), `total_to_collect` / `total_collected`.
  - Expandible → muestra `units[]` de ese batch con sus `expected` / `covered` / `status`.
- [ ] Header de la vista: mostrar los **totales agregados** del período (`response.total_to_collect`, `response.total_collected`, `response.collection_percentage`).
- [ ] Manejar el batch sintético `id === "__legacy__"` con un label tipo "Sin categorizar" o "Invoices pre-rediseño".

### 4.5 Nuevo: reversa manual de entry
- [ ] Agregar un botón "Revertir movimiento" en cada fila del historial del ledger.
- [ ] Modal con textarea para `reason` (min 10 chars, max 500). Confirm antes de llamar.
- [ ] Llamada: `POST /funds/:buildingId/entries/:entryId/reverse`.
- [ ] **Deshabilitar el botón** cuando la entry sea `type=reversal` o cuando ya tenga una reversal linkeada (buscar en la lista si existe una entry con `reference_type='reversal'` y `reference_id = entryId`).
- [ ] Mostrar en el listado que una entry está "reversada" — cruzar texto, etiqueta gris, etc.

### 4.6 Manejo de errores nuevos
- [ ] `400 AMOUNT_TOO_SMALL_TO_DISTRIBUTE` en `POST /assessments`: el `amount` en centavos es menor que el número de units.
- [ ] `400 NO_UNITS`: el building no tiene units. No debería pasar en la práctica.
- [ ] `409 INVALID_OPERATION` en reverse entry: no se puede reversar una reversal.
- [ ] `404` en reverse entry: entry no existe o scope mismatch (otro building).

---

## 5. Checklist — APK móvil

La APK es **read-only** en caja chica (solo residents, que ven balance + historial pero no escriben). Cambios mínimos.

### 5.1 Si la APK muestra balance del fondo del building del resident
- [ ] Cambiar endpoint consumido a `GET /api/v1/app/petty-cash/funds/:buildingId`.
- [ ] Eliminar referencia al campo `currency` (no existe más).
- [ ] **Soportar balance negativo** en el display (si la UI muestra caja chica al resident).

### 5.2 Si la APK muestra historial de caja chica
- [ ] `/transactions` → `/entries`.
- [ ] Shape del item cambió — ahora cada entry trae `type` (4 valores posibles), `amount` firmado, `reference_type`, `reference_id`. Mapear a la UI como "ingreso / gasto / cobro auto / reversa".

### 5.3 Pagos de cuotas PETTY_CASH (flujo existente, **no cambia en el cliente**)
- Cuando el resident paga una invoice PETTY_CASH con unit_id, **automáticamente** se genera una entry `collection` en el ledger del building. El cliente APK no hace nada distinto al flujo normal de `POST /payments`.
- Si la APK revierte pagos (poco probable desde APK, probablemente admin), lo mismo: el backend genera el counter-asiento. Cliente no cambia.

### 5.4 Transparency (si la APK la muestra)
- [ ] Mismo shape nuevo que el panel — `assessments[]` + totales globales.
- [ ] Si la APK solo mostraba el % global, leer `response.collection_percentage` (top-level) sigue funcionando.

---

## 6. Test plan consolidado

Smoke test end-to-end sobre staging:

```bash
# Preparar: un admin/board de un building, un resident con unit en ese building.

# 1. Balance inicial
GET /petty-cash/funds/:b
→ 200 { current_balance: 0, ... } (o lo que sea)

# 2. Income manual
POST /petty-cash/funds/:b/entries { type: "income", amount: 200, description: "Reposición inicial" }
→ 200 entry creada
GET /petty-cash/funds/:b
→ current_balance = 200

# 3. Expense que deja el balance negativo
POST /petty-cash/funds/:b/entries { type: "expense", amount: 300, description: "Ascensor", category: "REPAIR" }
→ 200 entry creada con amount = -300
GET /petty-cash/funds/:b
→ current_balance = -100   ← NEGATIVO, correcto

# 4. Preview + batch "ascensor"
GET /petty-cash/funds/:b/assessments
→ { current_balance: -100, total_overage: 100, pending_to_assess: 100, units: [...] }

POST /petty-cash/funds/:b/assessments
  { description: "Ascensor abril", amount: 100, category: "REPAIR" }
→ 200 { assessment_id: X, invoices: [...] }

# 5. Batch "agua" — simulando otro egreso que sube el overage
POST /petty-cash/funds/:b/entries { type: "expense", amount: 50, description: "Agua", category: "UTILITIES" }
POST /petty-cash/funds/:b/assessments
  { description: "Agua abril", amount: 50, category: "UTILITIES" }
→ 200 { assessment_id: Y, ... }

# 6. Transparency desglosado
GET /petty-cash/funds/:b/transparency?period=YYYY-MM
→ 200 { assessments: [{ description: "Ascensor abril", ... }, { description: "Agua abril", ... }], total_* }

# 7. Auto-collection — resident paga una cuota
POST /api/v1/app/payments  ← como resident, contra una invoice del batch "Ascensor"
PATCH /api/v1/admin/payments/admin/payments/:id { status: "APPROVED" }
GET /petty-cash/funds/:b
→ current_balance subió por el monto cobrado (collection entry creada automáticamente)
GET /petty-cash/funds/:b/entries?type=collection
→ aparece la entry nueva con reference_type=invoice_payment

# 8. Reverse manual
POST /petty-cash/funds/:b/entries/:entryId/reverse
  { reason: "El gasto era incorrecto, monto equivocado" }
→ 200 entry de tipo reversal
GET /petty-cash/funds/:b
→ balance restaurado

# 9. Intentar reversar la reversal
POST /petty-cash/funds/:b/entries/:reversalEntryId/reverse
  { reason: "Se puede hacer esto?" }
→ 409 INVALID_OPERATION
```

---

## 7. Preguntas frecuentes

**Q: ¿Qué pasa si corro 2 veces el mismo `POST /assessments { description: "Ascensor", amount: 500 }`?**
A: Se crean **dos batches**. El backend no tiene idempotency sobre description — cada llamada es una operación independiente. El admin es responsable. Si sucede por error, usar el endpoint de cancelar invoice (si existe) o borrar el batch manualmente desde la DB (destructivo, no recomendado).

**Q: ¿Puedo usar `amount` decimal con más de 2 decimales?**
A: No. El backend redondea a centavos (DECIMAL(12,2)). Si mandás `100.555`, el backend lo maneja como `100.56` (redondeo default).

**Q: ¿Puedo crear una entry de tipo `collection` o `reversal` desde el cliente?**
A: No, el schema del endpoint `POST /entries` solo acepta `income` / `expense`. Los otros dos los genera el backend internamente (auto-collection en ApprovePayment, auto-reversal en ReversePayment, reverse manual via el endpoint dedicado).

**Q: ¿El currency volvió?**
A: No. Fue eliminado en Phase 3 porque era decorativo — invoices y payments tampoco lo soportan. Si eventualmente el sistema va multi-currency, será un cambio sistémico, no del módulo de caja chica solo.

**Q: ¿Dónde puedo ver el detalle técnico de todo esto?**
A: `docs/docs.md` sección 4.1 (entidades) y secciones 7.5–7.10 (flujos completos). Los PRs #28 / #29 / #30 tienen los commits y contexto histórico.
