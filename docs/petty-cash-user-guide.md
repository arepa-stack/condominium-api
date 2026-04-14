# Caja Chica — Guia de Usuario

## 1. Que es la Caja Chica

La Caja Chica es un fondo de dinero asignado a cada edificio para cubrir gastos menores del dia a dia: reparaciones, limpieza, emergencias, materiales de oficina y servicios publicos. Cada edificio tiene su propio fondo independiente.

---

## 2. Quien puede hacer que

### Junta de Condominio (Board)
Opera **exclusivamente desde el Web Admin**. No usa la APK.
- Ver el balance actual del fondo de su edificio
- Ver el historial completo de movimientos
- Registrar ingresos (reposiciones del fondo)
- Registrar gastos con evidencia fotografica
- Ver los recibos de caja chica separados de los recibos normales
- Ver el credito/saldo a favor de cualquier unidad de su edificio
- Aprobar o rechazar pagos

### Administrador (Admin)
Opera **exclusivamente desde el Web Admin**. No usa la APK.
- Todo lo que puede hacer la Junta, pero en TODOS los edificios

### Residente
- Ver el balance del fondo de caja chica de su edificio (transparencia)
- Ver el historial de movimientos de su edificio
- Ver su propio credito/saldo a favor
- **No puede** registrar ingresos ni gastos

---

## 3. Desde donde se accede

### Aplicacion Movil (APK) — Solo Residentes
La APK es **exclusiva para residentes**. Junta y Admin no usan la APK.
- Consultar balance y historial de caja chica de su edificio (solo lectura)
- Ver su credito/saldo a favor
- Ver sus recibos (filtrables por tipo)
- Reportar pagos con comprobante
- Consultar estado de solvencia

### Panel Web Admin — Solo Junta y Admin
El Web Admin es la **unica plataforma** para Junta y Admin. Toda la operacion se concentra aqui.
- Registrar ingresos y gastos de caja chica
- Aprobar o rechazar pagos
- Ver recibos unificados con filtro por tipo (caja chica vs normales)
- Ver credito/saldo a favor de unidades
- Importacion masiva de facturas
- Carga de deuda manual
- Gestion de usuarios y roles
- Dashboard de gestion

Los residentes **no tienen acceso** al Panel Web Admin.
La Junta y Admin **no usan la APK**.

---

## 4. Flujos de Usuario

### 4.1 Consultar el Balance de Caja Chica

**Quien**: Junta, Admin, Residente
**Donde**: APK o Web Admin

1. Abrir la seccion "Caja Chica"
2. Seleccionar el edificio (si aplica)
3. Se muestra el balance actual del fondo

---

### 4.2 Registrar un Ingreso (Reposicion del Fondo)

**Quien**: Junta, Admin
**Donde**: Solo Web Admin

1. Ir a "Caja Chica" → "Registrar Ingreso"
2. Completar:
   - **Edificio**: Seleccionar el edificio
   - **Monto**: Cantidad a depositar en el fondo
   - **Descripcion**: Motivo del ingreso (ej: "Reposicion mensual")
3. Confirmar
4. El balance del fondo aumenta inmediatamente

**Ejemplo**: El fondo tenia $200. Se registra un ingreso de $300. Nuevo balance: $500.

---

### 4.3 Registrar un Gasto

**Quien**: Junta, Admin
**Donde**: Solo Web Admin

1. Ir a "Caja Chica" → "Registrar Gasto"
2. Completar:
   - **Edificio**: Seleccionar el edificio
   - **Monto**: Cantidad gastada
   - **Descripcion**: Detalle del gasto (ej: "Reparacion puerta del lobby")
   - **Categoria**: Seleccionar una:
     - Reparaciones
     - Limpieza
     - Emergencias
     - Material de oficina
     - Servicios publicos
     - Otros
   - **Evidencia** (opcional): Foto del comprobante o factura
3. Confirmar

**Que pasa internamente**:
- Se descuenta el monto del fondo
- Se genera automaticamente un recibo de caja chica (visible en la seccion de recibos con la etiqueta "Caja Chica")
- Si el gasto excede el fondo disponible, se usa lo que hay y el excedente se registra por separado

**Ejemplo con fondo suficiente**:
- Fondo: $500. Gasto: $80 por limpieza.
- Resultado: Fondo queda en $420. Se genera un recibo de $80 con etiqueta "Caja Chica".

**Ejemplo con fondo insuficiente**:
- Fondo: $30. Gasto: $80 por reparacion.
- Resultado: Se usan los $30 del fondo (balance queda en $0). Se generan recibos por los montos correspondientes.
- El excedente ($50) queda pendiente de cobro a las unidades (ver 4.6 Cobro de Excedente).

---

### 4.4 Ver el Historial de Movimientos

**Quien**: Junta, Admin, Residente
**Donde**: APK o Web Admin

1. Ir a "Caja Chica" → "Historial"
2. Se muestra la lista de todos los movimientos con:
   - Tipo (Ingreso o Gasto)
   - Monto
   - Descripcion
   - Categoria
   - Fecha
   - Quien lo registro
   - Evidencia (si tiene)
3. Se puede filtrar por:
   - Tipo: Solo ingresos o solo gastos
   - Categoria: Reparaciones, Limpieza, etc.

---

### 4.5 Ver Recibos — Filtrar por Tipo

**Quien**: Junta, Admin (Web Admin); Residente (APK, solo su unidad)
**Donde**: Web Admin (vista completa con filtros), APK (vista de unidad)

La seccion de Recibos/Facturas muestra una vista unificada de todos los recibos del edificio. Se pueden filtrar por etiqueta:

| Filtro | Que muestra |
|--------|-------------|
| **Todos** | Recibos normales + recibos de caja chica |
| **Normal** | Solo recibos de condominio (deuda mensual, extraordinarios) |
| **Caja Chica** | Solo gastos de caja chica registrados como recibos |

Esto permite a la Junta tener una vision completa de todos los movimientos financieros del edificio en un solo lugar.

---

### 4.6 Cobro de Excedente a Unidades (Assessments)

**Que es**: Cuando los gastos de caja chica superan los ingresos, la Junta puede generar facturas a las unidades para cubrir el excedente.

**Quien**: Junta, Admin
**Donde**: Solo Web Admin

**Paso 1 — Consultar el excedente**:
1. Ir a "Caja Chica" → "Cobro a Unidades" (o "Assessments")
2. El sistema muestra:
   - Total de gastos realizados
   - Total de ingresos recibidos
   - Balance actual del fondo
   - Excedente total (gastos - ingresos - balance)
   - Lo que ya se cobro a las unidades anteriormente
   - Lo pendiente por cobrar
   - Cuanto le corresponde a cada unidad (division equitativa)

**Ejemplo simple**:
- Ingresos totales: $16,000
- Gastos totales: $23,000
- Balance del fondo: $0
- Excedente: $7,000
- Ya cobrado: $0
- Pendiente: $7,000
- Unidades: 10 → $700 por unidad

**Ejemplo con residuo (division no exacta)**:
- Pendiente: $100
- Unidades: 3
- Distribucion: $33.34 + $33.33 + $33.33 = $100.00 exacto
  (la primera unidad absorbe el centavo de residuo, asi el total
  cierra siempre al centavo sin sobrar ni faltar)

**Paso 2 — Generar las facturas**:
1. Confirmar la generacion
2. Se crea una factura PENDIENTE por cada unidad del edificio
3. Las facturas aparecen con la etiqueta "Caja Chica" en la seccion de recibos
4. Los residentes pueden ver estas facturas en su APK y reportar el pago

**Notas**:
- Si no hay excedente pendiente, el sistema no permite generar facturas.
- Si el monto pendiente es tan bajo que no alcanza para dar al menos
  $0.01 a cada unidad (ej. $0.08 entre 38 unidades), el sistema
  rechaza la operacion. Es un monto que no puede repartirse
  justamente y el boton queda deshabilitado en el admin web.

---

### 4.7 Credito / Saldo a Favor por Unidad

**Que es**: Cuando un residente paga de mas en un recibo, el excedente se acumula como credito a favor de su unidad.

**Ejemplo**:
- El recibo de Enero es de $40
- El residente paga $50
- La Junta aprueba el pago
- El sistema detecta un sobrepago de $10
- Esos $10 quedan como credito/saldo a favor de la unidad

**Como consultar el credito**:

**Residente** (APK):
1. Ir a "Mi Unidad" → "Credito / Saldo a Favor"
2. Ver balance actual y el historial de como se fue acumulando

**Junta/Admin** (Web Admin o APK):
1. Ir a "Facturacion" → Seleccionar unidad → "Credito"
2. Ver balance y historial de credito de cualquier unidad de su edificio

**Nota**: El consumo del credito (usar el saldo a favor para pagar recibos futuros) se implementara en una futura actualizacion. Por ahora, el credito se acumula y se puede consultar.

---

## 5. Preguntas Frecuentes

### Puedo ver la caja chica de otro edificio?
- **Admin**: Si, puede ver la de todos los edificios.
- **Junta**: No, solo la del edificio donde tiene rol de Junta. Si intenta acceder a otro edificio, el sistema le mostrara un error de permisos.
- **Residente**: Solo puede ver (lectura) la caja chica de su propio edificio.

### Que pasa si registro un gasto y no hay suficiente fondo?
El sistema usa todo lo que hay disponible en el fondo y registra el gasto igualmente. El fondo queda en $0. No se bloquea la operacion — el gasto se documenta completo para mantener la trazabilidad. El excedente queda pendiente y la Junta puede generar facturas a las unidades para cubrirlo (ver "Cobro de Excedente").

### Los gastos de caja chica aparecen como recibos?
Si. Cada gasto de caja chica genera automaticamente un recibo con la etiqueta "Caja Chica". Esto permite ver todos los movimientos financieros del edificio en un solo lugar, filtrando entre recibos normales y de caja chica.

### Que pasa si pago de mas un recibo?
El excedente se acumula como credito/saldo a favor de tu unidad. Podes consultar tu credito en cualquier momento. En el futuro, este credito podra usarse para pagar recibos automaticamente.

### Quien puede registrar gastos de caja chica?
Solo la Junta de Condominio (de su edificio) y el Administrador. Los residentes no pueden registrar gastos.

### Puedo adjuntar una foto del comprobante?
Si. Al registrar un gasto, podes adjuntar una foto del comprobante o factura como evidencia. Es opcional pero recomendado para la transparencia.

### Donde veo las fotos de los comprobantes?
En el historial de movimientos de caja chica, cada gasto que tenga evidencia adjunta mostrara un enlace o miniatura de la foto.

---

## 6. Resumen de Acciones por Rol y Plataforma

| Accion | Admin (Web Admin) | Junta (Web Admin) | Residente (APK) |
|--------|-------------------|-------------------|-----------------|
| Ver balance de caja chica | Todos los edificios | Su edificio | Su edificio (lectura) |
| Ver historial de movimientos | Todos los edificios | Su edificio | Su edificio (lectura) |
| Registrar ingreso | Si | Su edificio | No |
| Registrar gasto | Si | Su edificio | No |
| Preview cobro excedente | Si | Su edificio | No |
| Generar facturas excedente | Si | Su edificio | No |
| Ver recibos (filtrar por tag) | Todos | Su edificio | Solo su unidad |
| Ver credito de unidad | Todas las unidades | Unidades de su edificio | Solo su unidad |
| Aprobar/rechazar pagos | Si | Su edificio | No |
| Cargar deuda | Si | Su edificio | No |
| Importar facturas Excel | Si | Su edificio | No |
| Reportar pago | No (no usa APK) | No (no usa APK) | Si |
| Gestionar usuarios | Si | Su edificio | No |
