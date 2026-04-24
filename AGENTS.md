# Repository Agents & Skills

## Project Overview

Condominio API Server is a backend API for a mobile application built with **Bun**, **ElysiaJS**, and **Supabase**. It follows **Clean Architecture** with strict separation of concerns.

### Architecture Layers
- **Core:** Configuration, Logger, Shared Errors.
- **Infrastructure:** Supabase Client, Storage Service.
- **Modules:** Business features (Auth, Users, Buildings, Payments, Dashboard).

## Available Skills

| Skill | Description | URL |
|-------|-------------|-----|
| `ddd-implementation` | Patterns for Entities, Value Objects, Aggregates | [SKILL.md](.agents/skills/ddd-implementation/SKILL.md) |
| `hexagonal-architecture` | Layers and dependency rules for Hexagonal Architecture | [SKILL.md](.agents/skills/hexagonal-architecture/SKILL.md) |

## Implementation Guidelines

When implementing new features, always refer to these skills to ensure consistency with the project's architectural standards.

### Domain-Driven Design
Refer to `ddd-implementation` for:
- Creating new Domain Entities.
- Structuring Aggregates.
- Validation logic in Value Objects.

### Hexagonal Architecture
Refere to `hexagonal-architecture` for:
- Placing files in the correct directory `domain`, `application`, `infrastructure`.
- Implementing Repository interfaces.
- Controller and Use Case interaction.

## Naming Convention

Strict separation of naming styles per layer. **Do not mix within a single file.**

| Layer | Style | Examples |
|---|---|---|
| **Domain entities** (props, constructors, `toJSON()`, getters) | `snake_case` | `building_id`, `unit_id`, `created_at`, `first_name` |
| **Repositories** (SQL, Supabase `select`/`insert`/`update`) | `snake_case` | Postgres columns directly |
| **Use-case DTOs** (application input/output interfaces) | `camelCase` | `buildingId`, `firstName`, `reviewerAppRole` |
| **HTTP** (TypeBox body/query/response schemas + JSON payloads) | `snake_case` | `{ "building_code": "...", "unit_id": "..." }` |
| **Local variables & functions** | `camelCase` | `const buildingId = ...`, `isBoardOfBuilding()` |

### Mapping boundary: presentation ↔ application

The presentation layer maps between `snake_case` HTTP fields and `camelCase` use-case DTOs.

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

- Mix `camelCase` and `snake_case` TypeBox field names in the same route file.
- Expose a camelCase getter (e.g. `get buildingId()`) from a domain entity — the HTTP contract must never depend on entity shape.
- Rename a Postgres column to camelCase — DB stays snake_case.

### Known outliers

None pending. The shared pagination metadata (`total_pages`, `has_next_page`, `has_prev_page`) was migrated to snake_case alongside the other HTTP fields.

New code MUST follow the table above.

## Commits

- Conventional Commits (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`).
- Do NOT add `Co-Authored-By` or AI attribution lines.
- Do NOT `--amend` a pushed commit; create a new commit.
