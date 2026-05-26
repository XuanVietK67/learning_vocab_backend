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

## Admin Vocabularies — `/v1/admin/vocabularies`

Source: [src/vocabularies/admin-vocabularies.controller.ts](../src/vocabularies/admin-vocabularies.controller.ts)

Write surface for the curated system catalog. All endpoints require JWT auth **and** the caller's `role = 'admin'` (returns 403 otherwise). Each write runs in a transaction so partial failures roll back.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/admin/vocabularies` | JWT (admin) | Create one system vocabulary with optional nested translations, examples, and topic links (by slug). Returns 409 if `(language, lemma, partOfSpeech)` already exists — use bulk-import for upsert semantics. |
| POST | `/v1/admin/vocabularies/bulk-import` | JWT (admin) | Idempotent upsert of up to 500 vocabularies in one transaction. Body: `{ items: CreateVocabularyDto[] }`. Returns summary `{ upserted, inserted, updated, translationsAdded, examplesAdded, topicLinksAdded }`. Topic slugs must already exist. |
| PATCH | `/v1/admin/vocabularies/:id` | JWT (admin) | Partial update of top-level fields only (`ipa`, `cefrLevel`, `frequencyRank`, `audioUrl`, `imageUrl`, and the natural-key fields). Translations / examples / topic links are not patched here — use bulk-import or DELETE + POST. |
| DELETE | `/v1/admin/vocabularies/:id` | JWT (admin) | Hard-delete a system vocabulary. Cascades to its translations, examples, topic links, and deck memberships. Returns 204. |

## Topics — `/v1/topics`

Source: [src/topics/topics.controller.ts](../src/topics/topics.controller.ts)

Public read access to the curated topic taxonomy used to tag vocabularies.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/topics` | none | List every topic, ordered by name. Returns a flat array (no pagination — set is small). |
| GET | `/v1/topics/:slug` | none | Fetch one topic by its slug (e.g. `food`, `travel`). Returns 404 if unknown. |

## Decks — `/v1/decks` and `/v1/me/decks`

Source: [src/decks/decks.controller.ts](../src/decks/decks.controller.ts)

Public catalog of system-curated learning decks plus the per-user "suggested for me" endpoint. User-owned decks are out of scope for these routes; they will land on `/v1/me/decks` in a later phase.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/decks` | none | List system decks (those with `owner_id IS NULL`). Query: `language`, `cefrLevel` (A1–C2), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with summary fields only — no vocab inlined. |
| GET | `/v1/decks/:id` | none | Fetch one deck with its ordered vocabulary list (each vocab includes its translations). Query: `translationLang` restricts the nested translations to one language. |
| GET | `/v1/me/decks/suggested` | JWT | Returns system decks matching the authenticated user's `targetLanguage` and `proficiencyLevel` from onboarding. Returns an empty array if either onboarding field is unset. |

## Learning Progress — `/v1/me/progress` and `/v1/me/stats`

Source: [src/progress/progress.controller.ts](../src/progress/progress.controller.ts)

Per-user spaced-repetition state and study stats. All endpoints require JWT auth. Scheduling uses the SM-2 algorithm ([src/progress/srs.ts](../src/progress/srs.ts)); a card moves from `new` → `learning` on first review, `learning` → `review` after 3 correct repetitions in a row, and `review` → `mastered` once its interval reaches 90 days.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/progress/enroll` | JWT | Add words to the caller's learning queue. Body: `{ vocabularyIds: string[] }` or `{ deckId: string }` (exactly one). Idempotent — already-enrolled words are skipped. Returns `{ enrolled, alreadyEnrolled, unknownVocabularyIds }`. |
| GET | `/v1/me/progress/due` | JWT | Fetch due cards (`next_review_at <= now`), oldest-due first. Query: `limit` (default 20, max 100), `translationLang` (filters nested translations). Each item includes the progress row and its full vocabulary (with translations). |
| POST | `/v1/me/progress/review` | JWT | Submit a review grade. Body: `{ vocabularyId, quality }` where quality is 0–5 (≥3 counts as correct). Runs SM-2; updates `repetitions`, `easeFactor`, `intervalDays`, `nextReviewAt`, status, and correct/incorrect counters. Returns the updated progress row. Returns 404 if the user is not enrolled in that word. |
| GET | `/v1/me/stats` | JWT | Snapshot for the home screen: `{ streakDays, dueNow, reviewedToday, dailyGoalMinutes, counts: { new, learning, review, mastered } }`. Streak is consecutive UTC days with at least one review ending at the most recent review date (counts only if that date is today or yesterday). |
