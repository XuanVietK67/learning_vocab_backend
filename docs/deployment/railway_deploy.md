# Deployment — Railway + GitHub Actions CI/CD

How this backend is built, hosted, and shipped. The app runs as **two long-lived
Node processes** — the HTTP **api** ([src/main.ts](../../src/main.ts)) and the
BullMQ **worker** ([src/worker.ts](../../src/worker.ts), which drains the audio /
image / enrichment / scoring queues) — both backed by **PostgreSQL** and
**Redis**.

## Topology

One Railway **project** with five components:

| Component | What | Source |
| --- | --- | --- |
| `Postgres` | Managed database plugin | Railway plugin |
| `Redis` | Managed key-value plugin (BullMQ) | Railway plugin |
| `api` service | HTTP API; public domain; runs migrations on deploy | this repo, [Dockerfile](../../Dockerfile), config [railway.json](../../railway.json) |
| `worker` service | Queue consumer; no public port | this repo, same [Dockerfile](../../Dockerfile), config [railway.worker.json](../../railway.worker.json) |
| `opus-mt` service | OPUS-MT translation sidecar; no public port; healthcheck `/health` | this repo, [services/opus-mt/Dockerfile](../../services/opus-mt/Dockerfile) |

The `api` and `worker` services build the **same image** and differ only in start
command (`node dist/main.js` vs `node dist/worker.js`). The `opus-mt` service is a
separate Python image (FastAPI + CTranslate2) that the **worker** calls over the
private network for enrichment translation — see
[services/opus-mt/README.md](../../services/opus-mt/README.md).

## Build

`npm run build` = `nest build && tsc-alias -p tsconfig.build.json`:

- The Nest build uses the **`tsc` builder** ([nest-cli.json](../../nest-cli.json)), so the whole `src` tree is emitted to `dist/` — including `dist/worker.js`, every `dist/**/*.entity.js`, and `dist/database/migrations/*.js`. (The webpack builder would bundle only `main` and break the worker's glob-based entity discovery.)
- `tsc-alias` rewrites the `@/*` path aliases into relative `require`s so the compiled output runs under plain Node with no `tsconfig-paths` at runtime.

The [Dockerfile](../../Dockerfile) is multi-stage: a `deps` stage builds production
`node_modules` (compiling the `bcrypt` native addon against the runtime base), a
`build` stage compiles `dist/`, and a slim `runner` stage carries only
`dist/` + production deps.

## Migrations

Run as the api service's **pre-deploy command** (`npm run db:migration:run:prod`
→ `node dist/database/run-migrations.js`), so they apply once per release, inside
Railway, before the new version serves traffic. The runner
([src/database/run-migrations.ts](../../src/database/run-migrations.ts)) is a
standalone TypeORM `DataSource` that needs only the connection + compiled
migration files (no entities, no dev-only `tsconfig-paths`). The **worker** does
not run migrations.

## One-time setup

1. **Create the project** → add the **Postgres** and **Redis** plugins.
2. **Add the `api` service** from this GitHub repo. In its settings set the
   **config file** to `railway.json`.
3. **Add the `worker` service** from the same repo. Set its **config file** to
   `railway.worker.json`.
4. **Add the `opus-mt` service** from the same repo. Set its **root directory** to
   `services/opus-mt` (so the build context holds `app.py` / `requirements.txt`
   for the Dockerfile's `COPY` steps) **and** its **config file** to
   [services/opus-mt/railway.json](../../services/opus-mt/railway.json). Both are
   essential: without the per-service config the build falls back to the repo-root
   `railway.json` and deploys the **Node** image instead of the Python sidecar
   (the build log will show `npm install` / `WORKDIR /app` — that's the wrong
   image). The config pins the Dockerfile build and the `/health` healthcheck.
   No public domain needed for prod. Set these variables on it: `OPUS_MT_TOKEN`
   (the shared secret) and `PORT=8001` (explicit, so the app binds a fixed port
   the worker can target over the private network — without it Railway picks a
   random port and the `:8001` internal URL breaks). The service binds IPv6
   (`::`) for Railway's private network.
5. For **all** services, turn **off** "Deploy on push" (GitHub Actions drives
   deploys, gated on green checks — see below).
6. **Create a deploy token:** Project → Settings → Tokens → new token. Add it to
   the GitHub repo as the **`RAILWAY_TOKEN`** secret
   (Settings → Secrets and variables → Actions).
7. **Set environment variables** (project-level shared variables, inherited by
   the services — see the table below).
8. **Protect `master`:** require the `build` check to pass before merging.

## Environment variables

Reference the plugin-provided values so they stay in sync:

| Key | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | |
| `PORT` | (injected by Railway) | api service binds to it automatically |
| `DB_HOST` | `${{Postgres.PGHOST}}` | use `.railway.internal` (private) host |
| `DB_PORT` | `${{Postgres.PGPORT}}` | |
| `DB_USERNAME` | `${{Postgres.PGUSER}}` | |
| `DB_PASSWORD` | `${{Postgres.PGPASSWORD}}` | |
| `DB_NAME` | `${{Postgres.PGDATABASE}}` | |
| `DB_SSL` | `false` over the private network; `true` over the public proxy | |
| `REDIS_HOST` | `${{Redis.REDISHOST}}` | |
| `REDIS_PORT` | `${{Redis.REDISPORT}}` | |
| `REDIS_PASSWORD` | `${{Redis.REDISPASSWORD}}` | |
| `CORS_ORIGINS` | deployed frontend origin(s), comma-separated | required for browser calls |
| `OPUS_MT_SERVICE_URL` | `http://opus-mt.railway.internal:8001` | worker → sidecar over the private network (Railway internal host) |
| `OPUS_MT_TOKEN` | shared secret | must match the value set on the `opus-mt` service; gates the sidecar |

Plus every app secret from [.env.example](../../.env.example): `JWT_*`,
`LEARN_HMAC_SECRET`, `CLOUDINARY_*`, `GEMMA_*`, `PEXELS_API_KEY`, `TTS_VOICE`,
the worker concurrency knobs, `PRONUNCIATION_*` (+ the HF Space token),
`OPUS_MT_*` (`SERVICE_URL`, `TOKEN`, `TIMEOUT_MS`, `MAX_ATTEMPTS`), and
`SMTP_*` / `MAIL_FROM`. The `opus-mt` service itself only needs `OPUS_MT_TOKEN`
(and Railway's injected `PORT`).

## CI/CD pipeline

[.github/workflows/ci.yml](../../.github/workflows/ci.yml):

- **On every PR to `master` and every push to `master`** — the `build` job runs
  `npm install` → `lint:ci` → `build` → `test`. This is the required gate.
- **On push to `master` only** (after `build` passes) — the `deploy` job installs
  the Railway CLI and runs `railway up --ci --service api` then
  `... --service worker`, authenticated by `RAILWAY_TOKEN`. Each upload builds the
  already-tested commit on Railway; the api's pre-deploy command runs migrations
  before cutover. **Service names must match** the names created in the project
  (`api`, `worker`).
- The **`opus-mt`** sidecar is **not** part of this pipeline — its model/code
  change rarely, so redeploy it from the Railway dashboard (or add a third
  `railway up --service opus-mt`) when [services/opus-mt/](../../services/opus-mt/)
  actually changes.

## Rollback

In the Railway dashboard, open the service → **Deployments** → pick a previous
successful deployment → **Redeploy**. (Migrations are forward-only; a rollback
that needs a schema revert must add a new down-migration.)

## Local validation

```bash
npm run build
node dist/main.js          # GET http://localhost:3000/health -> {"status":"ok"}
node dist/worker.js        # logs "audio worker started"

# container parity
docker build -t lv-api .
docker run --rm -p 3000:3000 --env-file .env lv-api               # api
docker run --rm --env-file .env lv-api node dist/worker.js        # worker
```
