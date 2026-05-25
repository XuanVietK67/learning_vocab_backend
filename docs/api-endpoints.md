# API Endpoints

Single source of truth for every HTTP endpoint exposed by this backend.

**Update this file whenever an endpoint is added, removed, or its purpose changes.** See [CLAUDE.md](../CLAUDE.md).

## Conventions

- URI versioning is enabled with default version `1` (see [src/main.ts](../src/main.ts)). All controllers using `version: '1'` are reachable under `/v1/...`. The unversioned `AppController` is reachable at `/`.
- All request and response bodies are JSON.
- Authenticated endpoints require `Authorization: Bearer <accessToken>` issued by `/v1/auth/*` flows.
- Validation is global (`ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`), so unknown body fields are rejected.

## Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | none | Liveness check — returns the app hello string. |

## Auth — `/v1/auth`

Source: [src/auth/auth.controller.ts](../src/auth/auth.controller.ts)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/auth/register` | none | Create an email + password account and return access + refresh tokens. |
| POST | `/v1/auth/login` | none | Email + password login. Rate-limited by `AUTH_LOGIN_THROTTLE_*` env vars. |
| POST | `/v1/auth/refresh` | none (refresh token in body) | Exchange a refresh token for a fresh access + refresh pair. |
| POST | `/v1/auth/logout` | none (refresh token in body) | Revoke the given refresh token. Returns 204. |
| POST | `/v1/auth/google` | none | Sign in / sign up using a Google ID token. |
| POST | `/v1/auth/apple` | none | Sign in / sign up using an Apple ID token. |
| POST | `/v1/auth/github` | none | Sign in / sign up using a GitHub OAuth authorization code. |
| GET | `/v1/auth/me` | JWT | Return the currently authenticated user's profile. |

## Users — `/v1/users`

Source: [src/users/users.controller.ts](../src/users/users.controller.ts)

All endpoints require JWT auth and only allow the caller to act on their own user record (returns 403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/users/:id` | JWT (self) | Fetch the user's full profile (onboarding fields, role, identities meta). |
| PATCH | `/v1/users/:id` | JWT (self) | Update onboarding profile fields: `nativeLanguage`, `targetLanguage`, `proficiencyLevel`, `dailyGoalMinutes`. Setting all four marks the user as onboarded. |

## Vocabularies — `/v1/vocabularies`

Source: [src/vocabularies/vocabularies.controller.ts](../src/vocabularies/vocabularies.controller.ts)

Public read access to the curated system vocabulary catalog. User-created words (`source = 'user'`) are intentionally excluded from these endpoints and will be served by a separate `/v1/me/vocabularies` surface in a later phase.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/vocabularies` | none | List system vocabulary, ordered by frequency rank then lemma. Query: `language`, `cefrLevel` (A1–C2), `topic` (slug), `q` (lemma prefix), `translationLang` (filters nested translations), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with translations inlined. |
| GET | `/v1/vocabularies/:id` | none | Fetch a single vocabulary by UUID with its examples and translations. Query: `translationLang` to restrict translations to one language. |
