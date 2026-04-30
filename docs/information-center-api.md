# Centro de Información API

Guía para integrar el módulo **Centro de Información** desde un frontend React/Next.js.

## Base URLs

Todas las rutas requieren autenticación con Bearer token:

```http
Authorization: Bearer <access_token>
```

Rutas para residentes, junta y admin:

```text
/api/v1/app/information-center
```

Rutas administrativas para admin y junta:

```text
/api/v1/admin/information-center
```

El backend valida automáticamente:

- `admin`: puede leer y administrar cualquier edificio.
- `board`: puede administrar solo edificios donde pertenece a junta.
- `resident`: puede leer solo información de sus edificios/unidades.

Si no envías `building_id` en endpoints de lectura, el backend toma el primer edificio disponible del usuario autenticado.

## Categorías de Anuncios

Valores permitidos para `category`:

```ts
type AnnouncementCategory =
  | 'INFO'
  | 'URGENT'
  | 'FINANCIAL'
  | 'MAINTENANCE'
  | 'NEWS';
```

Si no se envía categoría al crear un anuncio, se usa `INFO`.

## Paginación

Los listados paginados usan:

```text
?page=1&limit=20
```

`limit` también acepta:

```text
?limit=all
```

Respuesta paginada:

```json
{
  "data": [],
  "metadata": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "total_pages": 0,
    "has_next_page": false,
    "has_prev_page": false
  }
}
```

## Cartelera: App

### Listar Anuncios Activos

```http
GET /api/v1/app/information-center/announcements
```

Query params opcionales:

- `building_id`: UUID del edificio. Si se omite, usa el edificio del usuario.
- `category`: `INFO`, `URGENT`, `FINANCIAL`, `MAINTENANCE`, `NEWS`.
- `search`: texto a buscar en título o contenido.
- `is_pinned`: boolean.
- `read_status`: `read` o `unread`.
- `page`: número de página.
- `limit`: número o `all`.

Ejemplo:

```http
GET /api/v1/app/information-center/announcements?category=URGENT&read_status=unread&page=1&limit=20
```

Respuesta:

```json
{
  "data": [
    {
      "id": "uuid",
      "building_id": "uuid",
      "author_id": "uuid",
      "title": "Corte de agua programado",
      "content": "El domingo habrá corte de agua...",
      "content_preview": "El domingo habrá corte de agua...",
      "category": "URGENT",
      "attachment_url": "https://signed-url.example",
      "is_pinned": true,
      "expires_at": "2026-05-01T23:59:59.000Z",
      "created_at": "2026-04-30T13:10:00.000Z",
      "updated_at": "2026-04-30T13:10:00.000Z",
      "read_by_current_user": false,
      "reacted_by_current_user": false,
      "metrics": {
        "reads_count": 10,
        "reactions_count": 4
      }
    }
  ],
  "metadata": {
    "total": 1,
    "page": 1,
    "limit": 20,
    "total_pages": 1,
    "has_next_page": false,
    "has_prev_page": false
  }
}
```

Notas frontend:

- `attachment_url` puede ser `null`.
- `attachment_url` es una URL firmada temporal.
- Los anuncios vencidos o eliminados no aparecen.
- Los fijados (`is_pinned = true`) aparecen primero.

### Obtener Detalle de Anuncio

```http
GET /api/v1/app/information-center/announcements/:id
```

Efecto de negocio:

- Marca automáticamente el anuncio como leído para el usuario autenticado.
- La lectura es idempotente: abrir varias veces no crea duplicados.

Respuesta: mismo shape de `Announcement`.

### Marcar Anuncio Como Leído

```http
POST /api/v1/app/information-center/announcements/:id/read
```

Body: no requiere body.

Respuesta:

```json
{
  "success": true
}
```

### Toggle "Entendido"

```http
POST /api/v1/app/information-center/announcements/:id/reaction
```

Body: no requiere body.

Efecto de negocio:

- Si no existe reacción, la crea.
- Si ya existe reacción, la elimina.
- Si el anuncio no estaba leído, también crea la lectura.

Respuesta al crear reacción:

```json
{
  "reacted": true,
  "reaction": {
    "announcement_id": "uuid",
    "user_id": "uuid",
    "reaction_type": "UNDERSTOOD",
    "created_at": "2026-04-30T13:10:00.000Z"
  }
}
```

Respuesta al quitar reacción:

```json
{
  "reacted": false,
  "reaction": null
}
```

## Cartelera: Admin/Junta

### Crear Anuncio

```http
POST /api/v1/admin/information-center/announcements
Content-Type: multipart/form-data
```

Campos `FormData`:

- `building_id`: UUID, requerido.
- `title`: string, requerido, mínimo 3 caracteres.
- `content`: string, requerido.
- `category`: opcional, enum de categoría.
- `attachment`: opcional, archivo PDF o imagen.
- `is_pinned`: opcional, boolean.
- `expires_at`: opcional, ISO string o `null`.

Ejemplo Next.js:

```ts
const form = new FormData();
form.append('building_id', buildingId);
form.append('title', title);
form.append('content', content);
form.append('category', 'URGENT');
form.append('is_pinned', String(true));
if (expiresAt) form.append('expires_at', expiresAt.toISOString());
if (file) form.append('attachment', file);

await fetch('/api/v1/admin/information-center/announcements', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
  },
  body: form,
});
```

Respuesta: `Announcement`.

### Editar Anuncio

```http
PATCH /api/v1/admin/information-center/announcements/:id
Content-Type: multipart/form-data
```

Campos `FormData` opcionales:

- `title`
- `content`
- `category`
- `attachment`
- `is_pinned`
- `expires_at`

Respuesta: `Announcement`.

### Eliminar Anuncio

```http
DELETE /api/v1/admin/information-center/announcements/:id
```

Efecto de negocio:

- Hace soft delete con `deleted_at`.
- Conserva lecturas, reacciones y métricas históricas.

Respuesta:

```json
{
  "success": true
}
```

### Métricas de Anuncio

```http
GET /api/v1/admin/information-center/announcements/:id/metrics
```

Respuesta:

```json
{
  "announcement_id": "uuid",
  "title": "Corte de agua programado",
  "total_residents": 150,
  "reads_count": 123,
  "pending_count": 27,
  "read_percentage": 82,
  "reactions_count": 36
}
```

### Lectores de Anuncio

```http
GET /api/v1/admin/information-center/announcements/:id/readers
```

Respuesta:

```json
[
  {
    "user_id": "uuid",
    "full_name": "María Pérez",
    "apartment": "Apt 101",
    "tower": null,
    "read_at": "2026-04-30T13:10:00.000Z",
    "status": "read"
  },
  {
    "user_id": "uuid",
    "full_name": "Carlos Gómez",
    "apartment": "Apt 102",
    "tower": null,
    "read_at": null,
    "status": "pending"
  }
]
```

## Reglas: App

### Listar Categorías Activas

```http
GET /api/v1/app/information-center/rules/categories
```

Query params opcionales:

- `building_id`

Respuesta:

```json
[
  {
    "id": "uuid",
    "building_id": "uuid",
    "name": "Convivencia",
    "description": "Reglas generales de convivencia",
    "icon": "home",
    "sort_order": 0,
    "is_active": true,
    "created_at": "2026-04-30T13:10:00.000Z",
    "updated_at": "2026-04-30T13:10:00.000Z"
  }
]
```

### Listar Reglas Publicadas

```http
GET /api/v1/app/information-center/rules
```

Query params opcionales:

- `building_id`

Respuesta:

```json
[
  {
    "id": "uuid",
    "building_id": "uuid",
    "category_id": "uuid",
    "title": "Uso de áreas comunes",
    "content": "Las áreas comunes estarán disponibles...",
    "attachment_url": "https://signed-url.example",
    "is_published": true,
    "sort_order": 0,
    "created_at": "2026-04-30T13:10:00.000Z",
    "updated_at": "2026-04-30T13:10:00.000Z"
  }
]
```

### Detalle de Regla

```http
GET /api/v1/app/information-center/rules/:id
```

Respuesta: `Rule`.

Regla de negocio:

- Residentes solo pueden ver reglas publicadas y no eliminadas.
- Admin/junta pueden ver borradores si tienen permisos sobre el edificio.

## Reglas: Admin/Junta

### Crear Categoría

```http
POST /api/v1/admin/information-center/rules/categories
Content-Type: application/json
```

Body:

```json
{
  "building_id": "uuid",
  "name": "Mascotas",
  "description": "Normas para mascotas",
  "icon": "paw",
  "sort_order": 1,
  "is_active": true
}
```

Respuesta: `RuleCategory`.

### Listar Categorías Admin

```http
GET /api/v1/admin/information-center/rules/categories?building_id=<uuid>&include_inactive=true
```

Query params:

- `building_id`: opcional si el usuario solo tiene un edificio resolvible.
- `include_inactive`: opcional, boolean. Si es `true`, requiere permisos de administración sobre el edificio.

Respuesta: array de `RuleCategory`.

### Editar Categoría

```http
PATCH /api/v1/admin/information-center/rules/categories/:id
Content-Type: application/json
```

Body parcial:

```json
{
  "name": "Convivencia actualizada",
  "description": "Nueva descripción",
  "icon": "home",
  "sort_order": 2,
  "is_active": true
}
```

Respuesta: `RuleCategory`.

### Crear Regla

```http
POST /api/v1/admin/information-center/rules
Content-Type: multipart/form-data
```

Campos `FormData`:

- `building_id`: UUID, requerido.
- `category_id`: UUID o `null`, opcional.
- `title`: string, requerido, mínimo 3 caracteres.
- `content`: string, requerido.
- `attachment`: opcional, PDF o imagen.
- `is_published`: opcional, boolean. Default `false`.
- `sort_order`: opcional, number.

Respuesta: `Rule`.

### Listar Reglas Admin

```http
GET /api/v1/admin/information-center/rules?building_id=<uuid>&include_unpublished=true
```

Query params:

- `building_id`
- `include_unpublished`: opcional, boolean. Si es `true`, requiere permisos de administración.

Respuesta: array de `Rule`.

### Editar Regla

```http
PATCH /api/v1/admin/information-center/rules/:id
Content-Type: multipart/form-data
```

Campos `FormData` opcionales:

- `category_id`
- `title`
- `content`
- `attachment`
- `is_published`
- `sort_order`

Respuesta: `Rule`.

### Eliminar Regla

```http
DELETE /api/v1/admin/information-center/rules/:id
```

Efecto de negocio:

- Hace soft delete con `deleted_at`.

Respuesta:

```json
{
  "success": true
}
```

## Junta: App

### Obtener Junta Actual

```http
GET /api/v1/app/information-center/board
```

Query params opcionales:

- `building_id`

Respuesta:

```json
[
  {
    "member_id": "uuid",
    "role": "board",
    "building_id": "uuid",
    "profile": {
      "id": "uuid",
      "name": "María González",
      "email": "maria@example.com",
      "phone": "+584121234567"
    },
    "unit": {
      "id": "uuid",
      "name": "Apt 101"
    }
  }
]
```

Notas:

- Este endpoint reutiliza el módulo existente `directory`.
- El alta de miembros de junta sigue estando en el backend existente de usuarios/board-members.
- No se creó una tabla nueva de junta para evitar duplicar el modelo actual.

## Servicios Recomendados: App

### Listar Servicios Activos

```http
GET /api/v1/app/information-center/recommended-services
```

Query params opcionales:

- `building_id`

Respuesta:

```json
[
  {
    "id": "uuid",
    "building_id": "uuid",
    "name": "Electricista recomendado",
    "category": "Electricidad",
    "description": "Servicio recomendado por la administración",
    "phone": "+584121234567",
    "email": "electricista@example.com",
    "availability": "Lunes a viernes",
    "rating": 4.5,
    "is_recommended": true,
    "is_active": true,
    "created_at": "2026-04-30T13:10:00.000Z",
    "updated_at": "2026-04-30T13:10:00.000Z"
  }
]
```

### Detalle de Servicio

```http
GET /api/v1/app/information-center/recommended-services/:id
```

Respuesta: `RecommendedService`.

Regla de negocio:

- Residentes solo ven servicios activos.
- Admin/junta pueden ver servicios inactivos si tienen permisos sobre el edificio.

## Servicios Recomendados: Admin/Junta

### Crear Servicio

```http
POST /api/v1/admin/information-center/recommended-services
Content-Type: application/json
```

Body:

```json
{
  "building_id": "uuid",
  "name": "Plomero recomendado",
  "category": "Plomería",
  "description": "Atiende emergencias",
  "phone": "+584121234567",
  "email": "plomero@example.com",
  "availability": "24/7",
  "rating": 4.8,
  "is_recommended": true,
  "is_active": true
}
```

Respuesta: `RecommendedService`.

### Listar Servicios Admin

```http
GET /api/v1/admin/information-center/recommended-services?building_id=<uuid>&include_inactive=true
```

Query params:

- `building_id`
- `include_inactive`: opcional, boolean. Si es `true`, requiere permisos de administración.

Respuesta: array de `RecommendedService`.

### Editar Servicio

```http
PATCH /api/v1/admin/information-center/recommended-services/:id
Content-Type: application/json
```

Body parcial:

```json
{
  "name": "Plomero actualizado",
  "category": "Plomería",
  "description": "Nueva descripción",
  "phone": "+584129999999",
  "email": "nuevo@example.com",
  "availability": "Lunes a sábado",
  "rating": 4.7,
  "is_recommended": true,
  "is_active": true
}
```

Respuesta: `RecommendedService`.

### Desactivar Servicio

```http
DELETE /api/v1/admin/information-center/recommended-services/:id
```

Efecto de negocio:

- No elimina físicamente.
- Cambia `is_active` a `false`.

Respuesta:

```json
{
  "success": true
}
```

## Archivos Adjuntos

Los adjuntos están soportados en:

- Anuncios.
- Reglas.

Tipos permitidos:

- `application/pdf`
- `image/jpeg`
- `image/png`
- `image/webp`

Límite:

- 5 MB.

El backend guarda el archivo en un bucket privado y responde con `attachment_url` firmada. El frontend debe tratar esa URL como temporal y volver a consultar el recurso si expira.

## Reglas de Negocio Para UI

- Mostrar solo acciones administrativas si el usuario es `admin` o `board`.
- Si el usuario es `board`, permitir administración solo para sus edificios de junta.
- Un residente no debe ver botones de crear, editar o eliminar.
- Abrir detalle de anuncio cuenta como lectura.
- El botón “Entendido” debe usar la respuesta `reacted` para actualizar el estado local.
- Los anuncios fijados deben renderizarse primero; el backend ya los ordena así.
- Si `expires_at` está vencido, el anuncio no aparece en listados activos.
- Las reglas en borrador no deben mostrarse en la app de residentes.
- Los servicios inactivos no deben mostrarse en la app de residentes.
- Para formularios con archivos, usar `FormData` y no enviar `Content-Type` manualmente desde `fetch`; el navegador debe setear el boundary.

## Errores Esperados

El backend usa errores de dominio centralizados. El frontend debe contemplar:

- `401`: token ausente, inválido o expirado.
- `403`: usuario sin permisos sobre el edificio o acción.
- `404`: recurso no encontrado o no visible por estado.
- `400`: payload inválido, categoría inválida, adjunto inválido o archivo mayor a 5 MB.

Shape típico:

```json
{
  "error": "FORBIDDEN",
  "message": "Access denied. You cannot manage building <uuid>"
}
```

## Checklist Para El Frontend

- Crear cliente HTTP que inyecte `Authorization: Bearer <token>`.
- Crear tipos TypeScript para `Announcement`, `RuleCategory`, `Rule`, `RecommendedService`, `BoardMember`.
- Crear hooks separados para app y admin.
- Para admin, construir formularios de anuncios/reglas con `FormData`.
- En detalle de anuncio, refrescar cache/listado después de `GET /announcements/:id` porque marca leído.
- En “Entendido”, actualizar UI con `reacted` y `reaction`.
- Tratar `attachment_url` como nullable y temporal.
- Pasar `building_id` explícito cuando el usuario admin/junta pueda cambiar de edificio.
