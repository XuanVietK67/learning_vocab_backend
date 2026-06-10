# Project instructions — learning-vocab-backend

Project-specific rules for Claude. Global rules live in the user's `~/.claude/CLAUDE.md`.

## LaTeX report rule

**Whenever you write or edit the graduation thesis / đồ án report in LaTeX, you MUST follow [docs/report/latex_report_guide.md](docs/report/latex_report_guide.md) exactly.** It is the markdown transcription of the official `manual.pptx` ("Hướng dẫn viết đồ án bằng LaTeX") and is the authoritative format. Non-negotiable points from it:

- Use the provided **Overleaf template** matching the thesis direction (Research vs Application). Do not restructure it; keep `main.tex`, `Chuong/` (one `.tex` per chapter), the images folder, the cover-page `.tex`, the abbreviations file, and `references.bib`.
- **Images** via `graphicx`; **tables** via `tabular`; **math** via `amsmath` (inline `\(\)`/`$$` vs display `equation`/`\[\]`); **lists** via `itemize`/`enumerate`.
- Every figure, table, and numbered equation gets a **caption + `\label`**, referenced with **`\ref`**. **Never hardcode a number** — always `\label` + `\ref`.
- **References:** each source as a BibTeX entry in `references.bib`, cited with `\cite{ID}`. ❌ No Wikipedia, no unverified or ordinary web pages. Match the correct one of the **5 required reference-type formats** (book, conference paper, thesis, Internet source, …).

If anything in this rule conflicts with [docs/report/latex_report_guide.md](docs/report/latex_report_guide.md), the guide wins — read it before writing.

## Stack snapshot

- NestJS 11 + TypeORM + PostgreSQL.
- TypeScript, strict mode. UUID primary keys, `snake_case` column names, `timestamptz` for all timestamps.
- URI versioning is enabled (default `v1`). Use `@Controller({ path: '...', version: '1' })` on new controllers.
- Migrations live in [src/database/migrations/](src/database/migrations/) and are discovered by [src/database/data-source.ts](src/database/data-source.ts) via the `src/**/*.entity.ts` glob.

## Docs layout

`docs/` is split into subfolders — put new docs in the matching one:
- [docs/frontend/](docs/frontend/) — frontend-facing per-feature guides + the [frontend_handoff.md](docs/frontend/frontend_handoff.md) index.
- [docs/backend/](docs/backend/) — backend / API-contract docs ([api-endpoints.md](docs/backend/api-endpoints.md)).
- [docs/plans/](docs/plans/) — design & planning docs.
- [docs/report/](docs/report/) — the graduation thesis (đồ án) report and its writing guide.

## API documentation rule

[docs/backend/api-endpoints.md](docs/backend/api-endpoints.md) is the single source of truth for the HTTP API surface.

**Whenever you add, remove, rename, or change the purpose of an endpoint, update [docs/backend/api-endpoints.md](docs/backend/api-endpoints.md) in the same change** (same commit / same PR). Treat it as part of the API contract, not as follow-up work.

What "update" means in practice:
- New endpoint → add a row to the relevant module table with method, full path (including version prefix), auth requirement, and a one-sentence purpose.
- Removed endpoint → delete its row.
- Renamed path or method → edit the row in place.
- Behaviour change that alters the purpose (e.g. an endpoint now also marks the user as onboarded) → revise the purpose cell.

If a new module's endpoints don't fit any existing section, add a new `## ModuleName — /v1/<path>` section in the same alphabetical-ish order as the modules in [src/](src/), with a link back to the controller file.

Do not document internal helpers, guards, or DTOs there — only the externally callable HTTP surface.

## Frontend handoff rule

Frontend-facing documentation is split into **one doc per feature/endpoint**, not one growing file:

- **Per-feature docs** — each endpoint (or tightly-related group of endpoints, e.g. one CRUD resource or one workflow) gets its **own** Markdown file in [docs/frontend/](docs/frontend/) that explains it for a frontend engineer: the call, what to send, what comes back, client-side validation rules, error handling, and any async/UX gotchas. See [docs/frontend/admin_create_vocabulary.md](docs/frontend/admin_create_vocabulary.md) as the reference shape and depth.
- **[docs/frontend/frontend_handoff.md](docs/frontend/frontend_handoff.md)** — the **index**. It holds the shared conventions (base URL, versioning, auth header, pagination, error shape) and a table of contents linking to every per-feature doc. It does **not** hold per-endpoint request/response shapes anymore — those live in the per-feature docs.

**Whenever you add, remove, rename, or change the request/response shape of an endpoint, in the same change (same commit / same PR):**

1. Update [docs/backend/api-endpoints.md](docs/backend/api-endpoints.md) (the terse contract — see the rule above).
2. **New endpoint/feature** → create a new per-feature doc in [docs/frontend/](docs/frontend/), then add one link row to the index in [docs/frontend/frontend_handoff.md](docs/frontend/frontend_handoff.md).
3. **Changed endpoint** (DTO field added/removed/renamed, new validation constraint, new status code, new error condition, renamed path/method) → edit that endpoint's existing per-feature doc.
4. **Removed endpoint** → delete its per-feature doc and remove its link row from the index.
5. **Inline content still living in [docs/frontend/frontend_handoff.md](docs/frontend/frontend_handoff.md)** → when you touch a feature whose request/response shape is still written out inline in the handoff file (a leftover from before the split), **migrate it**: move that block into a new per-feature `docs/frontend/<area>_<action>.md`, then replace the inline block in the handoff file with a one-line link (`### METHOD /path` + a sentence + a link to the new doc) and add/keep its row in the index table. The handoff file must stay an index — never grow per-endpoint request/response bodies back into it. Migrate only the feature you are touching; leave other inline sections alone until their turn.

Conventions for per-feature docs:
- **Filename:** `docs/frontend/<area>_<action>.md` in `snake_case`, e.g. `admin_create_vocabulary.md`, `auth_login.md`, `decks_add_vocabularies.md`.
- **First line:** an `#` H1 naming the feature, followed by the method + full versioned path and the auth requirement.
- Cover: request headers/body, a **field-rules table** (required?, type, length/regex/enum), a realistic example request, the example response with status code, an error table, and any client-side validation or async behaviour the frontend must handle.
- Keep examples realistic (valid UUIDs, plausible values) and copy field names verbatim from the DTOs. Do not document internal helpers, guards, services, or DTO class names — only the externally callable HTTP surface as it appears on the wire.
