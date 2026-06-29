# Learning Vocab — Backend

REST API for an English‑vocabulary learning platform: curated topic/deck catalogs, spaced‑repetition study sessions, speaking + pronunciation practice, gamified progress, and AI‑assisted vocabulary enrichment. Built with **NestJS 11 + TypeORM + PostgreSQL**, with a **Redis/BullMQ** background worker for the heavy/async work (text‑to‑speech, sense images, AI enrichment, practice scoring).

The mobile/web client is a separate Next.js app ([XuanVietK67/learning_vocab_frontend_v2](https://github.com/XuanVietK67/learning_vocab_frontend_v2)).

## Features

- **Auth** — email/password with JWT access + refresh tokens, plus Google / Apple / GitHub OAuth and email verification (SMTP).
- **Vocabulary catalog** — topics, vocabularies with senses (IPA, audio, example sentences + translations, CEFR level, images), and decks. Admin CRUD + a "quick‑create" flow that auto‑enriches a bare word.
- **Learn** — signed, server‑validated study sessions (HMAC) over a user's decks.
- **Practice & pronunciation** — production attempts scored by an LLM, plus a phoneme‑level pronunciation‑scoring microservice.
- **Speaking room** — LLM‑driven live conversation practice with an end‑of‑session report.
- **Progress & leaderboard** — per‑user progress tracking and rankings.
- **Background worker** — TTS audio (Edge‑TTS → Cloudinary), sense images (Pexels → Cloudinary), AI enrichment (Gemini), and practice scoring, all via BullMQ queues.

## Tech stack

| Area | Choice |
|---|---|
| Framework | NestJS 11 (URI versioning, default `v1`) |
| Language | TypeScript (strict) |
| Database | PostgreSQL 16 + TypeORM (migrations, UUID PKs, `snake_case`, `timestamptz`) |
| Queue | Redis 7 + BullMQ |
| Auth | JWT (`@nestjs/jwt` + Passport) + OAuth |
| Media/CDN | Cloudinary |
| AI | Google Gemini (enrichment/scoring), Groq (speaking room), self‑hosted OPUS‑MT (translation) |

## Prerequisites

- **Node.js ≥ 20** and npm
- **Docker** + Docker Compose (for Postgres, pgAdmin, Redis)
- Optional API keys for the AI/media features (Cloudinary, Gemini, Groq, Pexels) — the core API runs without them; only the relevant async features are disabled.

## Installation

```bash
# 1. install dependencies
npm install

# 2. create your env file from the template and fill in secrets
cp .env.example .env
# generate strong secrets for JWT_* and LEARN_HMAC_SECRET, e.g.:
#   openssl rand -base64 48

# 3. start Postgres, pgAdmin and Redis
npm run db:up

# 4. run database migrations
npm run db:migration:run

# 5. (optional) seed the curated topic/vocabulary/deck catalog — idempotent
npm run db:seed
```

`.env.example` documents every variable. The essentials are `DB_*`, `JWT_*`, `LEARN_HMAC_SECRET`, and `REDIS_*`; the rest enable optional integrations (see comments in the file).

## Running the app

```bash
# HTTP API
npm run start          # one-off
npm run start:dev      # watch mode
npm run start:prod     # compiled (run `npm run build` first)

# background worker (TTS, images, enrichment, scoring) — separate process
npm run start:worker
```

The API listens on `PORT` (default **3000**). Routes are versioned under `/v1/...`; the liveness probe is version‑neutral at **`/health`**.

```bash
curl http://localhost:3000/health   # -> {"status":"ok"}
```

pgAdmin is available at `http://localhost:5050` (credentials from `PGADMIN_EMAIL` / `PGADMIN_PASSWORD`).

## Database & data scripts

```bash
npm run db:up                    # start postgres + pgadmin + redis (docker)
npm run db:down                  # stop them
npm run db:logs                  # tail postgres logs

npm run db:migration:run         # apply migrations
npm run db:migration:revert      # roll back the last migration
npm run db:migration:generate -- src/database/migrations/<Name>   # generate from entity changes
npm run db:seed                  # upsert the curated catalog (idempotent)

# one-off backfills for previously-imported rows
npm run db:backfill-audio
npm run db:backfill-images
npm run db:backfill-ipa
npm run db:backfill-example-translations
```

Migrations live in [src/database/migrations/](src/database/migrations/); seed data is the JSON under [src/database/seeds/data/](src/database/seeds/data/) — edit those and re‑run `npm run db:seed` to extend the catalog.

## Companion microservices

Some async features call out to small self‑hosted services (URLs/tokens configured in `.env`; leaving a URL blank disables that feature):

- **OPUS‑MT** ([services/opus-mt/](services/opus-mt/)) — machine‑translation sidecar for the enrichment path (`OPUS_MT_SERVICE_URL`, default `http://localhost:8001`).
- **Pronunciation scoring** — phoneme‑scoring microservice exposing `POST /score` (`PRONUNCIATION_SERVICE_URL`, default `http://localhost:8000`).

## Tests & quality

```bash
npm run test       # unit tests
npm run test:e2e   # end-to-end tests
npm run test:cov   # coverage
npm run lint       # eslint --fix
npm run build      # type-check + compile to dist/
```

## Project structure

```
src/
  auth/            JWT + OAuth + email verification
  users/           user accounts & profile
  vocabularies/    vocabularies, senses, enrichment, audio/image workers
  topics/          topic catalog
  decks/           decks & membership
  learn/           signed study sessions
  practice/        production attempts + LLM scoring
  pronunciation/   pronunciation scoring
  speaking-room/   LLM live conversation practice
  progress/        per-user progress
  leaderboard/     rankings
  mailer/          SMTP email
  health/          liveness probe
  config/          typed config namespaces (loaded by ConfigModule)
  database/        data-source, migrations, seeds, backfill scripts
  common/          shared guards, pipes, decorators
  main.ts          HTTP API entrypoint
  worker.ts        background worker entrypoint
services/opus-mt/  self-hosted translation sidecar
docs/              backend / frontend / deployment / plans / report docs
```

## Documentation

- **API contract** — [docs/backend/api-endpoints.md](docs/backend/api-endpoints.md) (single source of truth for the HTTP surface).
- **Frontend handoff** — [docs/frontend/frontend_handoff.md](docs/frontend/frontend_handoff.md) (per‑feature request/response guides).
- **Deployment** — [docs/deployment/](docs/deployment/).
- **Design & plans** — [docs/plans/](docs/plans/).
