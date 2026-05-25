# Project instructions — learning-vocab-backend

Project-specific rules for Claude. Global rules live in the user's `~/.claude/CLAUDE.md`.

## Stack snapshot

- NestJS 11 + TypeORM + PostgreSQL.
- TypeScript, strict mode. UUID primary keys, `snake_case` column names, `timestamptz` for all timestamps.
- URI versioning is enabled (default `v1`). Use `@Controller({ path: '...', version: '1' })` on new controllers.
- Migrations live in [src/database/migrations/](src/database/migrations/) and are discovered by [src/database/data-source.ts](src/database/data-source.ts) via the `src/**/*.entity.ts` glob.

## API documentation rule

[docs/api-endpoints.md](docs/api-endpoints.md) is the single source of truth for the HTTP API surface.

**Whenever you add, remove, rename, or change the purpose of an endpoint, update [docs/api-endpoints.md](docs/api-endpoints.md) in the same change** (same commit / same PR). Treat it as part of the API contract, not as follow-up work.

What "update" means in practice:
- New endpoint → add a row to the relevant module table with method, full path (including version prefix), auth requirement, and a one-sentence purpose.
- Removed endpoint → delete its row.
- Renamed path or method → edit the row in place.
- Behaviour change that alters the purpose (e.g. an endpoint now also marks the user as onboarded) → revise the purpose cell.

If a new module's endpoints don't fit any existing section, add a new `## ModuleName — /v1/<path>` section in the same alphabetical-ish order as the modules in [src/](src/), with a link back to the controller file.

Do not document internal helpers, guards, or DTOs there — only the externally callable HTTP surface.
