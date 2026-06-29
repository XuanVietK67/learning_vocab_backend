# Example sentence translation (manual create + backfill)

Change summary for the work on `feat/example-sentence-translation`.

- Feature commit: `feat(translation): add example sentence translation to display after user answer questions`
- Deploy fix commit: `fix(opus-mt): bind uvicorn to IPv4 so Railway healthcheck passes`

## Why

Example sentences (`vocabulary_examples.translation`) were only auto-translated on the **async enrichment / quick-create** path. Words created through the **manual** paths stored `translation = null` unless an admin typed one by hand. We want every example to carry a translation so the learning UI can **reveal it after the user answers a question** — the display side already supports it (`FlashcardSenseView.example.translation`, the cloze `hintTranslation`), the data was just missing.

## Decision

**Option A** — auto-fill blank example translations into the **configured default language** (`ENRICHMENT_TRANSLATION_LANGUAGE`, default `vi`), reusing the same engine enrichment uses.

- Engine is the self-hosted **OPUS-MT** sidecar, **not Gemma**. (`gemma.translationLanguage` is just a target-language config string despite the prefix.)
- The `vocabulary_examples.translation` column is a single, untagged string, so one language per example is the only coherent model — adding a per-request `translationLanguage` would need a schema change (a language column + display-side filtering) and was rejected for now.
- Admin/user-supplied translations are always kept verbatim; only blank ones are filled. MT failures degrade to `null` and never fail the create request.

## What changed (code)

### Auto-fill on every manual example-creation path
[src/vocabularies/vocabularies.service.ts](../../src/vocabularies/vocabularies.service.ts)

| Method | Endpoint |
|---|---|
| `createSystemVocabulary` | `POST /v1/admin/vocabularies` |
| `createUserVocabulary` | `POST /v1/me/vocabularies` |
| `addSense` | `POST /v1/admin/vocabularies/:id/senses` |
| `addExample` | `POST /v1/admin/vocabularies/:id/senses/:senseId/examples` |

- New helpers: `fillMissingExampleTranslations`, `fillBlankExampleTranslations` (generic, one batched MT call for all distinct blank sentences), `resolveExampleTranslation` (single example), `resolveExampleTranslationLanguage` (target = config default, never the word's own language).
- The MT call runs **outside** the DB transaction (same pattern as the post-commit audio enqueue).
- Injected `TranslationService` + `ConfigService` into the service constructor.

### Shared OPUS-MT client
[src/vocabularies/enrichment/sources/opus-mt.client.ts](../../src/vocabularies/enrichment/sources/opus-mt.client.ts) (new)

- `translateViaOpusMt(options, source, target, texts)` — the HTTP `POST /translate` + retry/back-off logic, extracted so the request shape never diverges between callers. Returns translations aligned to `texts`, `null` per item on failure, never throws.
- [translation.service.ts](../../src/vocabularies/enrichment/sources/translation.service.ts) now delegates its `callOpusMt` to this helper (behaviour unchanged).

### Module wiring
[src/vocabularies/vocabularies.module.ts](../../src/vocabularies/vocabularies.module.ts)

- Registered `TranslationService` as a provider and added `BilingualLexiconEntry` to `TypeOrmModule.forFeature` so the service resolves in the **API** process (it previously lived only in the worker module).

### Backfill for existing rows
[src/database/scripts/backfill-example-translations.ts](../../src/database/scripts/backfill-example-translations.ts) (new) · `npm run db:backfill-example-translations`

- Translates every `vocabulary_examples` row with `translation IS NULL`, grouped by source language, batched, via the shared OPUS-MT client.
- Idempotent and re-runnable (only touches null rows; only writes when MT returns a value).
- Flags: `--limit=N`, `--target=xx` (default `ENRICHMENT_TRANSLATION_LANGUAGE` / `vi`), `--dry-run`.
- Runs from a machine that can reach the sidecar's **public** URL (the `*.railway.internal` host is not reachable off-Railway).

### Tests / docs
- [vocabularies.service.spec.ts](../../src/vocabularies/vocabularies.service.spec.ts) — added `TranslationService` + `ConfigService` mocks. Full suite green (27 suites / 243 tests).
- Contract + frontend docs updated: [api-endpoints.md](../backend/api-endpoints.md), [admin_create_vocabulary.md](../frontend/admin_create_vocabulary.md), [me_create_vocabulary.md](../frontend/me_create_vocabulary.md).

## What changed (deployment)

The OPUS-MT sidecar lives in this monorepo at [services/opus-mt/](../../services/opus-mt/) and is deployed as a separate Railway service (no new repo). Three issues were fixed while bringing it up:

1. **Missing URL scheme** — `OPUS_MT_SERVICE_URL` must include `https://`; `fetch` can't parse a bare host.
2. **Wrong image** — the `opus-mt` Railway service was building the repo-root Node `Dockerfile` (per the root [railway.json](../../railway.json)). Added [services/opus-mt/railway.json](../../services/opus-mt/railway.json) and set the service's **root directory** to `services/opus-mt` + its **config file** to that file, so it builds the FastAPI Dockerfile.
3. **Healthcheck failed** — Railway's healthcheck proxy connects over IPv4, so the IPv6-only `::` listener failed every attempt. The [Dockerfile](../../services/opus-mt/Dockerfile) CMD now binds `0.0.0.0`. Consequence: the IPv4-only listener is not reachable over Railway's IPv6 private network, so `OPUS_MT_SERVICE_URL` must use the sidecar's **public** URL in all clients. See [railway_deploy.md](../deployment/railway_deploy.md).

## Config / env

| Var | Default | Purpose |
|---|---|---|
| `OPUS_MT_SERVICE_URL` | `''` (disables MT) | sidecar base URL — **public** `https://…` |
| `OPUS_MT_TOKEN` | `''` | shared secret; must match the value on the `opus-mt` service |
| `OPUS_MT_TIMEOUT_MS` | `15000` | per-attempt timeout |
| `OPUS_MT_MAX_ATTEMPTS` | `2` | retry count for cold-start/5xx |
| `ENRICHMENT_TRANSLATION_LANGUAGE` | `vi` | target language for auto-filled translations |

If `OPUS_MT_SERVICE_URL` is unset, auto-fill is silently skipped (translations stay `null`) and creates still succeed.

## Behaviour notes

- Only **blank** example translations are filled; supplied ones are untouched.
- A word is never translated into its own language.
- `updateExample` / `updateSense` are intentionally **not** auto-filled — editing is an explicit action where the caller controls the translation.
- The sidecar image bakes only the **en→vi** model pair; other pairs return `null` until added to the [Dockerfile](../../services/opus-mt/Dockerfile).

## How to verify

```bash
# 1. Sidecar is live and serving the Python app (not the Node 404):
curl -s -X POST https://<opus-mt-public-host>/translate \
  -H "content-type: application/json" \
  -d '{"source":"en","target":"vi","texts":["Fame can be ephemeral."]}'
# expect: {"translations":["..."]}

# 2. Backfill existing rows:
npm run db:backfill-example-translations -- --dry-run   # preview
npm run db:backfill-example-translations                # apply
```
