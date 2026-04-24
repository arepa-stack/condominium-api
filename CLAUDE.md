# condominium-server — project conventions

## Stack

- Runtime: Bun
- Framework: Elysia (HTTP) + TypeBox (schemas)
- DB: Supabase (Postgres) via `@supabase/supabase-js`
- Architecture: Clean / Hexagonal — `domain` → `application` → `infrastructure` / `presentation`

## Naming convention

Strict separation of naming styles per layer. **Do not mix within a single file.**

| Layer | Style | Examples |
|---|---|---|
| **Domain entities** (props, constructors, `toJSON()`, getters) | `snake_case` | `building_id`, `unit_id`, `created_at`, `first_name` |
| **Repositories** (SQL, Supabase `select`/`insert`/`update`) | `snake_case` | columnas Postgres directas |
| **Use-case DTOs** (application input/output interfaces) | `camelCase` | `buildingId`, `firstName`, `reviewerAppRole` |
| **HTTP** (TypeBox body/query/response schemas + JSON payloads) | `snake_case` | `{ "building_code": "...", "unit_id": "..." }` |
| **Local variables & functions** | `camelCase` | `const buildingId = ...`, `isBoardOfBuilding()` |

### Mapping boundary: presentation ↔ application

The presentation layer is responsible for mapping `snake_case` HTTP fields to `camelCase` use-case DTOs and back.

```ts
.post('/foo', async ({ body }) => {
    const result = await useCase.execute({
        buildingId: body.building_id,   // camel ← snake
        firstName:  body.first_name,
    });
    return { building_id: result.buildingId };
}, {
    body: t.Object({
        building_id: t.String({ format: 'uuid' }),
        first_name:  t.String({ minLength: 1 }),
    }),
    response: t.Object({
        building_id: t.String(),
    }),
});
```

### What NOT to do

- ❌ Mix `camelCase` and `snake_case` TypeBox field names in the same route file.
- ❌ Expose a camelCase getter (e.g. `get buildingId()`) from a domain entity — the HTTP contract must never depend on entity shape.
- ❌ Write a new module fully in camelCase (`leads`, `directory` are legacy outliers, not a pattern to follow).
- ❌ Rename a Postgres column to camelCase — DB stays snake_case.

### Known outliers (pending normalization)

- `src/modules/leads/*` — entire module in camelCase
- `src/modules/directory/BoardMember.ts` — getter exposes camel (`buildingId`)
- `src/modules/billing/presentation/routes.ts` — some endpoints use `invoiceId`, `issueDate`
- `src/modules/users/presentation/routes.ts` — mixed `body.buildingId` vs `body.building_id`

New code MUST follow the table above. Legacy outliers are fixed incrementally, not by adding more mixed code.

## Module structure

```
src/modules/<name>/
  domain/
    entities/        — domain objects with snake_case props
    repository.ts    — repository interface(s)
  application/
    use-cases/       — business logic, camelCase DTOs
  infrastructure/
    repositories/    — Supabase implementation, snake_case throughout
  presentation/
    routes.ts        — or {public,app,admin}-routes.ts; snake_case HTTP
```

## Commits

- Conventional Commits (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`).
- Do NOT add `Co-Authored-By` or AI attribution lines.
- Do NOT `--amend` a pushed commit; create a new commit.

## Testing

- Framework: `bun:test`
- Location: `tests/modules/<module>/...`
- Mock builders live alongside tests; keep them snake_case to match entity shape.
