# Condominium API — Módulo de Onboarding

**Base URL:** `https://<tu-dominio>` o `http://localhost:3000` en local  
**Swagger UI:** `GET /swagger`  
**Autenticación:** Bearer token en header `Authorization: Bearer <access_token>`

---

## Modelo de roles

El sistema tiene dos dimensiones de rol:

| Campo | Valores | Descripción |
|---|---|---|
| `app_role` | `"admin"` \| `"user"` | Capacidad global en la plataforma |
| `buildingRoles[]` | `{ building_id, role: "board" }` | Rol por edificio |

**Regla de acceso al panel admin:** `app_role === "admin"` OR `buildingRoles.length > 0`

**Regla para detectar residente:** `app_role === "user"` AND `buildingRoles.length === 0`

---

## Tipos compartidos

```typescript
type Building = {
  id: string               // UUID
  name: string
  address: string
  building_code: string    // Ej: "COND-A1B2C3D4" — código permanente del QR
  max_residents_per_unit: number  // Default: 2
  created_at: string       // ISO 8601
  updated_at: string
}

type Unit = {
  id: string               // UUID
  building_id: string
  name: string             // Ej: "Apto 4B"
  floor: string | null
  aliquot: number | null
  created_at: string
  updated_at: string
}

type AuthResponse = {
  access_token: string
  refresh_token: string
  expires_in: number       // segundos
  must_change_password: boolean  // true → redirigir a cambio de contraseña
  user: {
    id: string
    email: string
    app_role: "admin" | "user"
    units: Array<{
      unit_id: string
      building_id: string
      is_primary: boolean
    }>
    buildingRoles: Array<{
      building_id: string
      role: string         // "board"
    }>
  }
}

type RegistrationRequest = {
  id: string
  building_id: string
  unit_id: string
  email: string
  first_name: string
  last_name: string
  document_id: string
  phone: string | null
  source: "qr" | "invitation"
  status: "pending" | "approved" | "rejected"
  invited_by_profile_id: string | null
  invitation_id: string | null
  reviewed_by_profile_id: string | null
  reviewed_at: string | null
  rejection_reason: string | null
  created_at: string
}

type UnitInvitation = {
  id: string
  unit_id: string
  building_id: string
  inviter_profile_id: string
  invitee_email: string
  invitee_name: string | null
  token: string
  status: "pending" | "claimed" | "expired" | "cancelled"
  expires_at: string       // ISO 8601, default: 7 días desde creación
  claimed_at: string | null
  created_at: string
}

type InvitationMetadata = {
  inviterName: string
  unitName: string
  buildingName: string
  expiresAt: string        // ISO 8601
  isValid: boolean
}

type SuccessResponse = {
  success: boolean
}

type ErrorResponse = {
  code: string
  message: string
}
```

---

## Flujo completo de onboarding

```
FASE 1: Admin crea miembro de junta
  POST /api/v1/admin/board-members
    → crea usuario con must_change_password=true
    → envía email con credenciales temporales al board member

FASE 2: Board member hace login y cambia contraseña
  POST /auth/login → recibe must_change_password=true
  POST /auth/change-password-first-login → limpia el flag

FASE 3: Admin obtiene building_code del edificio (para generar QR)
  GET /buildings → lista edificios con building_code

FASE 4: Residente escanea QR y se registra
  GET /buildings/by-code/:code → datos del edificio
  GET /buildings/by-code/:code/units → unidades disponibles
  POST /registration-requests → envía solicitud, notifica al Board

FASE 5: Board aprueba o rechaza
  GET /api/v1/admin/registration-requests → lista solicitudes
  POST /api/v1/admin/registration-requests/:id/approve → crea cuenta y envía credenciales
  POST /api/v1/admin/registration-requests/:id/reject

FASE 6: Residente aprobado hace login y cambia contraseña
  (igual que Fase 2)

FASE 7: Residente invita a un compañero de unidad
  POST /api/v1/app/unit-invitations → genera token y envía email

FASE 8: Invitado acepta la invitación
  GET /invitations/:token → metadatos para pre-rellenar el form
  POST /invitations/:token/accept → crea solicitud → vuelve a Fase 5
```

---

## Auth

### `POST /auth/login`

Autentica al usuario y devuelve el JWT.

**No requiere autenticación**

**Request body:**
```json
{
  "email": "usuario@email.com",   // string, formato email
  "password": "MiPassword123"    // string
}
```

**Response `200`:** `AuthResponse`

> **IMPORTANTE:** Si `must_change_password === true`, el cliente **debe** redirigir a la pantalla de cambio de contraseña antes de permitir cualquier otra acción.

---

### `POST /auth/change-password-first-login`

Cambia la contraseña en el primer login y limpia el flag `must_change_password`.

**Requiere:** `Authorization: Bearer <token>`  
**Política de contraseña:** mínimo 8 caracteres, 1 mayúscula, 1 número

**Request body:**
```json
{
  "newPassword": "MiNueva123!"   // string, minLength: 8
}
```

**Response `200`:** `SuccessResponse`

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 401 | `UNAUTHORIZED` | Token inválido o ausente |
| 422 | `VALIDATION_ERROR` | No cumple la política de contraseña |

---

### `POST /auth/reset-password`

Envía un email de recuperación de contraseña.

**No requiere autenticación**

**Request body:**
```json
{
  "email": "usuario@email.com"
}
```

**Response `200`:** `SuccessResponse`

---

## Edificios y unidades (públicos)

### `GET /buildings`

Lista todos los edificios disponibles.

**No requiere autenticación**

**Response `200`:** `Building[]`

---

### `GET /buildings/:id`

Obtiene un edificio por su ID.

**No requiere autenticación**

**Params:** `id` — UUID del edificio

**Response `200`:** `Building`

---

### `GET /buildings/by-code/:code`

Obtiene un edificio por su `building_code` (código del QR).

**No requiere autenticación**

**Params:** `code` — Ej: `COND-A1B2C3D4`

**Response `200`:** `Building`

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 404 | `NOT_FOUND` | Código no existe |

---

### `GET /buildings/by-code/:code/units`

Lista las unidades de un edificio identificado por su `building_code`.  
Usar para poblar el selector de unidad en el formulario de registro.

**No requiere autenticación**

**Params:** `code` — Ej: `COND-A1B2C3D4`

**Response `200`:** `Unit[]`

---

### `GET /buildings/:id/units`

Lista las unidades de un edificio por su ID.

**No requiere autenticación**

**Params:** `id` — UUID del edificio

**Response `200`:** `Unit[]`

---

## Crear miembro de junta (Admin)

### `POST /api/v1/admin/board-members`

Crea un usuario con rol `board`, lo asigna al edificio y le envía por email una contraseña temporal generada automáticamente.

> **Implementación:** este endpoint utiliza internamente el mismo caso de uso `CreateUser`. Al no incluir `password` en el body, se activa el flujo de onboarding automáticamente: se genera una contraseña segura, se activa `must_change_password = true` y se envía el email de bienvenida con las credenciales.

**Requiere:** `Authorization: Bearer <token>` con `app_role === "admin"`

**Request body:**
```json
{
  "name": "María González",               // string, minLength: 1
  "email": "maria@edificio.com",          // string, formato email
  "phone": "+58 412 5551234",             // string, opcional
  "buildingId": "uuid-del-edificio",      // string, UUID
  "board_position": "Presidenta"          // string, opcional — cargo en la junta
}
```

**`board_position` — valores sugeridos:**
`"Presidente"` · `"Vicepresidente"` · `"Tesorero"` · `"Secretario"` · `"Vocal"`

**Response `200`:** objeto con el perfil del usuario creado
```json
{
  "id": "uuid",
  "email": "maria@edificio.com",
  "name": "María González",
  "app_role": "user",
  "status": "active",
  "must_change_password": true,
  "units": [],
  "buildingRoles": [
    { "building_id": "uuid-del-edificio", "role": "board" }
  ]
}
```

> El board member recibirá un email con sus credenciales temporales. Al hacer login, `must_change_password` será `true` y el cliente debe redirigirlo al cambio de contraseña.

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 403 | `FORBIDDEN` | El caller no es `admin` |
| 404 | `NOT_FOUND` | El edificio no existe |
| 409 | `USER_EXISTS` | Ya existe un usuario con ese email |

---

### `POST /api/v1/admin/users` — alternativa con contraseña manual

También se puede crear un usuario de tipo `board` mediante el endpoint general de usuarios, proveyendo una contraseña explícita. En ese caso **no** se genera contraseña temporal y **no** se envía email de bienvenida.

**Request body:**
```json
{
  "email": "juan@edificio.com",
  "password": "ContraseñaManual123",   // string — requerido en este endpoint
  "name": "Juan Rodríguez",
  "role": "board",
  "building_id": "uuid-del-edificio",
  "board_position": "Tesorero",        // string, opcional
  "phone": "+58 414 0001234"           // string, opcional
}
```

| Flujo | Endpoint | ¿Genera contraseña? | ¿Envía email? | `must_change_password` |
|---|---|---|---|---|
| Onboarding board member | `POST /api/v1/admin/board-members` | Sí, automático | Sí | `true` |
| Creación manual | `POST /api/v1/admin/users` | No (la provees tú) | No | `false` |

---

## Solicitudes de registro (flujo QR)

### `POST /registration-requests`

Envía una solicitud de registro desde el formulario del QR. El Board recibe una notificación por email.

**No requiere autenticación**

**Request body:**
```json
{
  "buildingCode": "COND-A1B2C3D4",   // string — del QR
  "unitId": "uuid-de-la-unidad",     // string, UUID
  "email": "residente@email.com",    // string, formato email
  "firstName": "Carlos",             // string, minLength: 1
  "lastName": "Pérez",               // string, minLength: 1
  "documentId": "V-12345678",        // string, minLength: 1
  "phone": "+58 414 1234567"         // string, opcional
}
```

**Response `201`:** `RegistrationRequest` (con `status: "pending"`)

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 404 | `NOT_FOUND` | Código de edificio o unidad no existe |
| 409 | `CAPACITY_EXCEEDED` | La unidad alcanzó el límite de residentes |
| 409 | `DUPLICATE_REQUEST` | Ya existe una solicitud pendiente con ese email para ese edificio |

---

### `GET /api/v1/admin/registration-requests`

Lista las solicitudes de registro. El Board solo ve las de sus edificios; el Admin ve todas.

**Requiere:** `Authorization: Bearer <token>` con rol `admin` o `board`

**Query params:**
```
buildingId?: string (UUID) — filtrar por edificio
status?: "pending" | "approved" | "rejected" — filtrar por estado
```

**Response `200`:** `RegistrationRequest[]`

---

### `POST /api/v1/admin/registration-requests/:id/approve`

Aprueba una solicitud: crea el perfil del residente, asigna la unidad, envía credenciales por email.

**Requiere:** `Authorization: Bearer <token>` con rol `admin` o `board`

**Params:** `id` — UUID de la solicitud

**Sin body**

**Response `200`:** `SuccessResponse`

> El residente recibirá un email con usuario y contraseña temporal. Su `must_change_password` será `true`.

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 403 | `FORBIDDEN` | El Board intenta aprobar una solicitud de otro edificio |
| 404 | `NOT_FOUND` | Solicitud no encontrada |
| 409 | `INVALID_STATE` | La solicitud no está en estado `pending` |
| 409 | `CAPACITY_EXCEEDED` | La unidad ya está llena al momento de aprobar |

---

### `POST /api/v1/admin/registration-requests/:id/reject`

Rechaza una solicitud. Envía email de rechazo al solicitante (opcional según configuración).

**Requiere:** `Authorization: Bearer <token>` con rol `admin` o `board`

**Params:** `id` — UUID de la solicitud

**Request body:**
```json
{
  "reason": "Documentación incompleta"   // string, opcional
}
```

**Response `200`:** `SuccessResponse`

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 403 | `FORBIDDEN` | El Board intenta rechazar una solicitud de otro edificio |
| 404 | `NOT_FOUND` | Solicitud no encontrada |
| 409 | `INVALID_STATE` | La solicitud no está en estado `pending` |

---

## Invitaciones de unidad (residente invita a compañero)

### `POST /api/v1/app/unit-invitations`

El residente invita a alguien a compartir su unidad. Genera un token y envía un email con el link de aceptación.

**Requiere:** `Authorization: Bearer <token>` con rol `resident`, `board` o `admin`

**Request body:**
```json
{
  "inviteeEmail": "vecino@email.com",   // string, formato email
  "inviteeName": "Luis Torres"          // string, opcional
}
```

**Response `201`:** `UnitInvitation`

> El link que recibirá el invitado por email será: `<APP_WEB_URL>/join?inv=<token>`

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 404 | `NOT_FOUND` | El invitador no tiene unidad asignada |
| 409 | `CAPACITY_EXCEEDED` | La unidad alcanzó el límite de residentes contando pendientes |

---

### `GET /api/v1/app/unit-invitations`

Lista las invitaciones enviadas por el usuario autenticado.

**Requiere:** `Authorization: Bearer <token>`

**Response `200`:** `UnitInvitation[]`

---

### `DELETE /api/v1/app/unit-invitations/:id`

Cancela una invitación propia que esté en estado `pending`.

**Requiere:** `Authorization: Bearer <token>`

**Params:** `id` — UUID de la invitación

**Response `200`:** `SuccessResponse`

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 403 | `FORBIDDEN` | La invitación no pertenece al usuario |
| 404 | `NOT_FOUND` | Invitación no encontrada |
| 409 | `INVALID_STATE` | La invitación no está en estado `pending` |

---

### `GET /invitations/:token`

Obtiene los metadatos públicos de una invitación por su token (para pre-rellenar el formulario de aceptación).

**No requiere autenticación**

**Params:** `token` — string del token recibido en el email

**Response `200`:** `InvitationMetadata`

```json
{
  "inviterName": "Carlos Pérez",
  "unitName": "Apto 4B",
  "buildingName": "Residencias El Pinar",
  "expiresAt": "2026-05-01T12:00:00Z",
  "isValid": true
}
```

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 404 | `NOT_FOUND` | Token no existe |
| 409 | `INVALID_INVITATION` | La invitación ya fue usada, expiró o fue cancelada |

---

### `POST /invitations/:token/accept`

El invitado acepta la invitación con sus datos personales. Crea una `RegistrationRequest` con `source: "invitation"` y notifica al Board.

**No requiere autenticación**

**Params:** `token` — string del token recibido en el email

**Request body:**
```json
{
  "firstName": "Luis",          // string, minLength: 1
  "lastName": "Torres",         // string, minLength: 1
  "documentId": "V-98765432",   // string, minLength: 1
  "phone": "+58 416 9876543"    // string, opcional
}
```

**Response `201`:** `RegistrationRequest` (con `status: "pending"`, `source: "invitation"`)

> Después de este paso, el flujo continúa en `POST /api/v1/admin/registration-requests/:id/approve`.

**Errores posibles:**
| Código HTTP | code | Descripción |
|---|---|---|
| 404 | `NOT_FOUND` | Token no existe |
| 409 | `INVALID_INVITATION` | Token ya usado, expirado o cancelado |

---

## Reglas de negocio clave

1. **`must_change_password`**: Cuando es `true` el cliente debe redirigir al usuario a la pantalla de cambio de contraseña **antes** de mostrar cualquier otra pantalla. El único endpoint que puede llamarse sin pasar por este check es `POST /auth/change-password-first-login`.

2. **Capacidad por unidad**: El sistema valida en cada solicitud y aprobación que el número de residentes activos + solicitudes pendientes no supere `building.max_residents_per_unit` (default: 2). Responde `409` si se excede.

3. **Invitaciones**: Expiran a los 7 días (configurable). Una vez expiradas o canceladas no pueden aceptarse. El token es de un solo uso (`status` pasa a `claimed` al aceptarse).

4. **`building_code`**: Es permanente e inmutable. El QR del edificio apunta a `<APP_WEB_URL>/register?code=<building_code>`. El frontend usa el código para llamar a los endpoints públicos de buildings.

5. **Acceso del Board**: Un miembro de la junta solo puede ver y gestionar solicitudes de **sus propios edificios** (`buildingRoles[].building_id`).

---

## Flujo de pantallas sugerido para el frontend

```
App móvil (residente):
  /login → si must_change_password → /change-password
  /register?code=COND-XXXX → formulario QR → /registro-enviado
  /join?inv=TOKEN → formulario aceptar invitación → /registro-enviado
  /my-invitations → lista de invitaciones enviadas

Panel admin / web (board + admin):
  /login → si must_change_password → /change-password
  /onboarding/requests → lista con filtros
  /onboarding/requests/:id → detalle con botones Aprobar / Rechazar
  /users/board → formulario crear miembro de junta
```
