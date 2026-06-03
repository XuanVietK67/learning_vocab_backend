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
| POST | `/v1/auth/email/send-verification` | JWT | Email a 6‑digit verification code to the authenticated user. 60s resend cooldown. Returns `{ expiresAt }`. |
| POST | `/v1/auth/email/verify` | JWT | Verify the 6‑digit code and set `isEmailVerified=true`. Returns the updated user. |

## Users — `/v1/users`

Source: [src/users/users.controller.ts](../src/users/users.controller.ts)

All endpoints require JWT auth and only allow the caller to act on their own user record (returns 403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/users/:id` | JWT (self) | Fetch the user's full profile (onboarding fields, role, identities meta). |
| PATCH | `/v1/users/:id` | JWT (self) | Update onboarding profile fields: `nativeLanguage`, `targetLanguage`, `proficiencyLevel`, `dailyGoalMinutes`, `weeklyVocabGoal`. Setting all five marks the user as onboarded. |

## Admin Users — `/v1/admin/users`

Source: [src/users/admin-users.controller.ts](../src/users/admin-users.controller.ts)

Admin-only write surface for user accounts. All endpoints require JWT auth **and** `role = 'admin'` (403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| DELETE | `/v1/admin/users/:id` | JWT (admin) | Hard-delete a non-admin user. Cascades to refresh tokens, identities, verification codes, progress rows, and personally-owned decks. User-created vocabularies (`source='user'`) stay but their `created_by_user_id` is set to NULL. Returns 403 if the target is an admin, 404 if not found, 204 on success. |

## Vocabularies — `/v1/vocabularies`

Source: [src/vocabularies/vocabularies.controller.ts](../src/vocabularies/vocabularies.controller.ts)

Public read access to the curated system vocabulary catalog. User-created words (`source = 'user'`) are intentionally excluded from these endpoints and will be served by a separate `/v1/me/vocabularies` surface in a later phase.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/vocabularies` | none | List system vocabulary, ordered by frequency rank then lemma. Query: `language`, `cefrLevel` (A1–C2), `topic` (slug), `q` (lemma prefix), `translationLang` (filters nested translations), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with the full sense tree (`senses[].translations[]`, `senses[].examples[]`) and the vocab's `topics[]` (sorted by slug) inlined. |
| GET | `/v1/vocabularies/:id` | none | Fetch a single vocabulary by UUID with all of its senses (each containing its own translations and examples) and its `topics[]` (sorted by slug). Query: `translationLang` to restrict translations to one language. |

## My Vocabularies — `/v1/me/vocabularies`

Source: [src/vocabularies/me-vocabularies.controller.ts](../src/vocabularies/me-vocabularies.controller.ts)

User-created (`source = 'user'`) words owned by the authenticated caller. Private by default (`visibility = 'private'`, `is_approved = false`). They share storage with system vocabularies but are scoped to the owner — they don't appear on the public `/v1/vocabularies` surface. All endpoints require JWT auth; cross-user access returns 403.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/vocabularies` | JWT | Create a personal vocabulary. Body carries one or more `senses[]`, each with its own translations, examples, and `imageUrl`. Topic slugs (vocab-level) must already exist in the system catalog. Returns 409 if the caller already has a word for `(language, lemma, partOfSpeech)`. |
| GET | `/v1/me/vocabularies` | JWT | List the caller's own vocabularies, newest first. Query: `language`, `q` (lemma prefix), `translationLang`, `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with senses and `topics[]` (sorted by slug) inlined. |
| GET | `/v1/me/vocabularies/:id` | JWT | Fetch one of the caller's vocabularies with all of its senses (each with translations and examples) and its `topics[]`. Query: `translationLang`. 403 if the row exists but isn't owned by the caller. |
| PATCH | `/v1/me/vocabularies/:id` | JWT | Partial update of top-level fields. Senses, translations, examples, and topic links are not patched here. |
| DELETE | `/v1/me/vocabularies/:id` | JWT | Hard-delete the caller's vocabulary. Cascades to its translations, examples, topic links, deck memberships, and progress rows. Returns 204. |

## Admin Vocabularies — `/v1/admin/vocabularies`

Source: [src/vocabularies/admin-vocabularies.controller.ts](../src/vocabularies/admin-vocabularies.controller.ts)

Write surface for the curated system catalog. All endpoints require JWT auth **and** the caller's `role = 'admin'` (returns 403 otherwise). Each write runs in a transaction so partial failures roll back.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/admin/vocabularies` | JWT (admin) | List the **entire** vocabulary table (system + user) with admin-only fields (`visibility`, `isApproved`, `createdByUserId`, `createdAt`, `updatedAt`) inlined. Query: `language`, `cefrLevel` (A1–C2), `topic` (slug), `q` (lemma prefix), `source` (`system`/`user`), `isApproved` (`true`/`false`; empty = no filter), `visibility` (`system`/`private`/`public`), `createdByUserId` (uuid), `translationLang`, `sortBy` (`createdAt` default \| `frequencyRank`), `sortDir` (`asc` default \| `desc`), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with the full sense tree and `topics[]` (sorted by slug) inlined. |
| POST | `/v1/admin/vocabularies` | JWT (admin) | Create one system vocabulary. Body carries one or more `senses[]` (each with translations, examples, and per-sense `imageUrl`) plus vocab-level topic links by slug. Returns 409 if `(language, lemma, partOfSpeech)` already exists — use bulk-import for upsert semantics. |
| POST | `/v1/admin/vocabularies/bulk-import` | JWT (admin) | Idempotent upsert of up to 500 vocabularies in one transaction. Body: `{ items: CreateVocabularyDto[] }`. Returns summary `{ upserted, inserted, updated, sensesAdded, translationsAdded, examplesAdded, topicLinksAdded }`. Senses match by `senseOrder` (request position); translations match by `(language, translation)` within a sense; examples are append-only. Topic slugs must already exist. |
| PATCH | `/v1/admin/vocabularies/:id` | JWT (admin) | Partial update of top-level fields only (`ipa`, `cefrLevel`, `frequencyRank`, `audioUrl`, and the natural-key fields). Senses, translations, examples, and topic links are not patched here — use bulk-import or DELETE + POST. |
| DELETE | `/v1/admin/vocabularies/:id` | JWT (admin) | Hard-delete a system vocabulary. Cascades to its translations, examples, topic links, and deck memberships. Returns 204. |
| POST | `/v1/admin/vocabularies/:id/senses` | JWT (admin) | Append a new sense to a vocabulary (`senseOrder` auto-assigned to `max+1`). Body: `{ gloss?, definition?, imageUrl?, translations?, examples? }`. Returns 201 with the created sense and its children. |
| PATCH | `/v1/admin/vocabularies/:id/senses/:senseId` | JWT (admin) | Patch `gloss`, `definition`, `imageUrl` on a sense. Returns the updated sense (with translations + examples). 404 if the sense doesn't belong to the vocabulary. |
| DELETE | `/v1/admin/vocabularies/:id/senses/:senseId` | JWT (admin) | Hard-delete a sense. Cascades to its translations and examples; remaining sibling senses are compacted so `senseOrder` stays contiguous `1..N`. Returns 204. |
| PUT | `/v1/admin/vocabularies/:id/senses/reorder` | JWT (admin) | Reassign `senseOrder` by array position. Body: `{ senseIds: string[] }` — must be a permutation of the vocab's current sense ids (400 otherwise). Returns the full sense list in the new order. |
| POST | `/v1/admin/vocabularies/:id/senses/:senseId/translations` | JWT (admin) | Add a translation to a sense. Body: `{ language, translation, note? }`. 409 if `(senseId, language, translation)` already exists. |
| PATCH | `/v1/admin/vocabularies/:id/senses/:senseId/translations/:translationId` | JWT (admin) | Patch `language`, `translation`, `note`. Re-checks the unique `(senseId, language, translation)` constraint (409 on conflict). |
| DELETE | `/v1/admin/vocabularies/:id/senses/:senseId/translations/:translationId` | JWT (admin) | Hard-delete a translation. Returns 204. 404 if the translation doesn't belong to the parent sense. |
| POST | `/v1/admin/vocabularies/:id/senses/:senseId/examples` | JWT (admin) | Add an example sentence to a sense. Body: `{ sentence, translation?, source? }`. |
| PATCH | `/v1/admin/vocabularies/:id/senses/:senseId/examples/:exampleId` | JWT (admin) | Patch `sentence`, `translation`, `source`. |
| DELETE | `/v1/admin/vocabularies/:id/senses/:senseId/examples/:exampleId` | JWT (admin) | Hard-delete an example. Returns 204. 404 if the example doesn't belong to the parent sense. |
| PUT | `/v1/admin/vocabularies/:id/topics` | JWT (admin) | Replace the topic-link set for a vocabulary. Body: `{ slugs: string[] }` (size 0–32; empty clears all links). 400 if any slug is unknown. Returns the resulting topic list, sorted by slug. |

## Topics — `/v1/topics`

Source: [src/topics/topics.controller.ts](../src/topics/topics.controller.ts)

Public read access to the curated topic taxonomy used to tag vocabularies.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/topics` | none | List every topic, ordered by name. Returns a flat array (no pagination — set is small). |
| GET | `/v1/topics/:slug` | none | Fetch one topic by its slug (e.g. `food`, `travel`). Returns 404 if unknown. |

## Admin Topics — `/v1/admin/topics`

Source: [src/topics/admin-topics.controller.ts](../src/topics/admin-topics.controller.ts)

Write surface for the topic taxonomy. All endpoints require JWT auth **and** `role = 'admin'` (403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/admin/topics` | JWT (admin) | Create a topic. Body: `{ slug, name, description?, iconUrl? }`. Slug must match `[a-z0-9-]+` (2–64 chars). Returns 409 if the slug already exists. |
| PATCH | `/v1/admin/topics/:slug` | JWT (admin) | Update `name`, `description`, or `iconUrl`. Slug itself is the identifier and not editable — to rename, DELETE then POST. |
| DELETE | `/v1/admin/topics/:slug` | JWT (admin) | Remove the topic. Cascades to `vocabulary_topics` (vocabularies stay, just lose this tag). Returns 204. |

## Decks — `/v1/decks` and `/v1/me/decks`

Source: [src/decks/decks.controller.ts](../src/decks/decks.controller.ts)

Public catalog of system-curated learning decks plus the per-user "suggested for me" endpoint. User-owned decks are out of scope for these routes; they will land on `/v1/me/decks` in a later phase.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/decks` | none | List system decks (those with `owner_id IS NULL`). Query: `language`, `cefrLevel` (A1–C2), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with summary fields only — no vocab inlined. |
| GET | `/v1/decks/:id` | none | Fetch one deck with its ordered vocabulary list (each vocab includes its senses → translations + examples). Query: `translationLang` restricts the nested translations to one language. |
| GET | `/v1/me/decks/suggested` | JWT | Returns system decks matching the authenticated user's `targetLanguage` and `proficiencyLevel` from onboarding. Returns an empty array if either onboarding field is unset. |

## My Decks — `/v1/me/decks`

Source: [src/decks/decks.controller.ts](../src/decks/decks.controller.ts)

Personal decks owned by the authenticated caller (`owner_id = me`, `visibility = 'private'`). Membership accepts system vocabularies plus the caller's own (`source='user'`) words — other users' private words are dropped into `inaccessibleVocabularyIds`. All endpoints require JWT auth; cross-user access returns 403.

Route ordering note: `GET /v1/me/decks/suggested` is a literal path declared before `/:id`, so it resolves correctly. The collection endpoints below coexist with it.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/decks` | JWT | Create a personal deck. Body: `{ name, description?, language, cefrLevel?, vocabularyIds? }`. If `vocabularyIds` is provided, members are appended in array order (inaccessible IDs surfaced via the membership endpoint instead — for create they are silently skipped). Server sets `owner_id`, `visibility='private'`, `vocab_count`. Returns the full deck detail. |
| GET | `/v1/me/decks` | JWT | List the caller's own decks, newest first. Query: `language`, `cefrLevel` (A1–C2), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` — summary fields only. |
| GET | `/v1/me/decks/:id` | JWT | Fetch one of the caller's decks with its ordered vocabulary list. Query: `translationLang`. 403 if owned by someone else. |
| PATCH | `/v1/me/decks/:id` | JWT | Top-level updates only (`name`, `description`, `language`, `cefrLevel`). Membership has its own endpoints. |
| DELETE | `/v1/me/decks/:id` | JWT | Hard-delete the caller's deck. Cascades to `deck_vocabularies` (vocabularies themselves stay). Returns 204. |
| POST | `/v1/me/decks/:id/vocabularies` | JWT | Append words to the deck. Body: `{ vocabularyIds: string[] }` (1–500). Returns `{ added, alreadyMember, inaccessibleVocabularyIds, vocabCount }`. Positions are assigned after the current max. |
| DELETE | `/v1/me/decks/:id/vocabularies/:vocabularyId` | JWT | Remove a word from the deck. 404 if it isn't in the deck. Returns 204. Decrements `vocab_count`. |

## Learn — `/v1/me/learn`

Source: [src/learn/learn.controller.ts](../src/learn/learn.controller.ts)

Context-anchored learning sessions: the server picks due cards, generates one question per card from its example sentences, and HMAC-signs each item so answers can be graded statelessly. Six question types: cloze MCQ, cloze typing, meaning-in-context, sentence build, sense disambiguation, listening cloze. Type selection is driven by SRS status; styles requiring extra data (audio, multiple senses, translation language) are skipped silently when unavailable. All endpoints require JWT auth.

`POST /v1/me/learn/session` is mode-driven — the caller picks one of `daily | topic | deck | review`. The server's `VocabPickerService` ([src/learn/vocab-picker.service.ts](../src/learn/vocab-picker.service.ts)) selects suitable vocab for each mode; for `daily/topic/deck` it auto-enrolls fresh picks into the user's progress as a side effect (`enrolledNewlyCount` in the response says how many). `daily` and `topic` require onboarding to be complete (`targetLanguage` and `proficiencyLevel`), else 400.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/learn/session` | JWT | Build a session of N questions for a learning mode. Body: `{ mode, topicSlug?, deckId?, limit?: 1–50 (default 15), translationLang? }`. `topicSlug` required iff `mode=topic`; `deckId` required iff `mode=deck`. Returns `{ sessionId, mode, enrolledNewlyCount, emptyReason, nextDueAt, items[] }`. `emptyReason` is one of `no_due_cards | no_more_at_level | no_enrollment | deck_exhausted` (null when `items[]` is non-empty). `nextDueAt` is the ISO timestamp of the soonest future-scheduled card — populated only when `emptyReason='no_due_cards'` so the empty-state screen can show "come back at X"; null in every other case. Each item carries an HMAC signature + nonce + issuedAtMs the client echoes when submitting an answer. |
| POST | `/v1/me/learn/answer` | JWT | Submit one answer. Body: `{ vocabularyId, type, exampleId, userAnswer, latencyMs, nonce, issuedAtMs, signature, translationLang? }`. Server verifies HMAC (30 min TTL), re-derives the correct answer, grades the response (mapping to SM-2 quality 0–5), then updates progress via the same SM-2 pipeline as `/v1/me/progress/review`. Returns `{ correct, correctAnswer, quality, progress, requeue }`. `requeue` is `{ dueAtMs, item }` when the card is scheduled to come back within `LEARN_REQUEUE_WINDOW_MINUTES` (default 15) — the client surfaces `item` again at `dueAtMs` without a new `/session` call; null otherwise. 401 if the signature is invalid or expired. |



Source: [src/progress/progress.controller.ts](../src/progress/progress.controller.ts)

Per-user spaced-repetition state and study stats. All endpoints require JWT auth. Scheduling uses SM-2 ([src/progress/srs.ts](../src/progress/srs.ts)) extended with Anki-style **learning steps**: new and lapsed cards cycle through minute-scale intervals (default `1m, 10m` via `LEARN_LEARNING_STEPS_MINUTES`) before graduating to the day-scale ladder. A card with `learningStepIndex !== null` is in step state; once past the final step it graduates to `intervalDays=1`, then `6`, then `interval * easeFactor`. After graduation `learning → review` follows 3 consecutive correct reps and `review → mastered` triggers when the interval reaches 90 days. A miss on a graduated card drops it back into step 0 (relearning).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/progress/enroll` | JWT | Add words to the caller's learning queue. Body: `{ vocabularyIds: string[] }` or `{ deckId: string }` (exactly one). Accepts system vocabularies plus the caller's own (`source='user'`) words — other users' private words are silently dropped into `unknownVocabularyIds`. Idempotent — already-enrolled words are skipped. Returns `{ enrolled, alreadyEnrolled, unknownVocabularyIds }`. |
| GET | `/v1/me/progress/due` | JWT | Fetch due cards (`next_review_at <= now`), oldest-due first. Query: `limit` (default 20, max 100), `translationLang` (filters nested translations). Each item includes the progress row and its full vocabulary (with senses → translations + examples). |
| POST | `/v1/me/progress/review` | JWT | Submit a review grade. Body: `{ vocabularyId, quality }` where quality is 0–5 (≥3 counts as correct). Runs SM-2; updates `repetitions`, `easeFactor`, `intervalDays`, `nextReviewAt`, status, and correct/incorrect counters. Returns the updated progress row. Returns 404 if the user is not enrolled in that word. |
| GET | `/v1/me/stats` | JWT | Snapshot for the home screen: `{ streakDays, dueNow, reviewedToday, dailyGoalMinutes, counts: { new, learning, review, mastered }, nextDueAt }`. Streak is consecutive UTC days with at least one review ending at the most recent review date (counts only if that date is today or yesterday). `nextDueAt` is the ISO timestamp of the soonest progress row scheduled in the future, or null when the user has no future-scheduled cards. |

## Pronunciation — `/v1/me/pronunciation`

Source: [src/pronunciation/me-pronunciation.controller.ts](../src/pronunciation/me-pronunciation.controller.ts)

Records a learner saying a word/phrase and scores their pronunciation with Azure Pronunciation Assessment. The upload is transcoded server-side (ffmpeg → 16 kHz mono PCM) and discarded after scoring — no audio is retained. All endpoints require JWT auth and are rate-limited (`PRONUNCIATION_RATE_*` env vars).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/pronunciation/attempts` | JWT | Submit a recorded clip (`multipart/form-data`: `audio` file + `referenceText`, optional `locale`) and synchronously return overall + per-component scores (accuracy, fluency, completeness, prosody), a `passed` flag, and a per-word/per-phoneme accuracy breakdown. The attempt is persisted. 400 on missing/undecodable/over-length audio or unsupported locale; 422 when no speech is detected; 502 when the scoring provider is unavailable. |
