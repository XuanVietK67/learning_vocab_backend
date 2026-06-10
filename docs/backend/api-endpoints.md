# API Endpoints

Single source of truth for every HTTP endpoint exposed by this backend.

**Update this file whenever an endpoint is added, removed, or its purpose changes.** See [CLAUDE.md](../../CLAUDE.md).

## Conventions

- URI versioning is enabled with default version `1` (see [src/main.ts](../../src/main.ts)). All controllers using `version: '1'` are reachable under `/v1/...`. The unversioned `AppController` is reachable at `/`.
- All request and response bodies are JSON.
- Authenticated endpoints require `Authorization: Bearer <accessToken>` issued by `/v1/auth/*` flows.
- Validation is global (`ValidationPipe` with `whitelist + forbidNonWhitelisted + transform`), so unknown body fields are rejected.

## Health

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | none | Liveness check — returns the app hello string. |

## Auth — `/v1/auth`

Source: [src/auth/auth.controller.ts](../../src/auth/auth.controller.ts)

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

Source: [src/users/users.controller.ts](../../src/users/users.controller.ts)

All endpoints require JWT auth and only allow the caller to act on their own user record (returns 403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/users/:id` | JWT (self) | Fetch the user's full profile (onboarding fields, role, identities meta). |
| PATCH | `/v1/users/:id` | JWT (self) | Update onboarding profile fields: `nativeLanguage`, `targetLanguage`, `proficiencyLevel`, `dailyGoalMinutes`, `weeklyVocabGoal`. Setting all five marks the user as onboarded. |

## Admin Users — `/v1/admin/users`

Source: [src/users/admin-users.controller.ts](../../src/users/admin-users.controller.ts)

Admin-only write surface for user accounts. All endpoints require JWT auth **and** `role = 'admin'` (403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| DELETE | `/v1/admin/users/:id` | JWT (admin) | Hard-delete a non-admin user. Cascades to refresh tokens, identities, verification codes, progress rows, and personally-owned decks. User-created vocabularies (`source='user'`) stay but their `created_by_user_id` is set to NULL. Returns 403 if the target is an admin, 404 if not found, 204 on success. |

## Vocabularies — `/v1/vocabularies`

Source: [src/vocabularies/vocabularies.controller.ts](../../src/vocabularies/vocabularies.controller.ts)

Public read access to the curated system vocabulary catalog. User-created words (`source = 'user'`) are intentionally excluded from these endpoints and will be served by a separate `/v1/me/vocabularies` surface in a later phase.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/vocabularies` | none | List **published** (approved) system vocabulary, ordered by frequency rank then lemma. Unapproved quick-create drafts are excluded. Query: `language`, `cefrLevel` (A1–C2), `topic` (slug), `q` (lemma prefix), `translationLang` (filters nested translations), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with the full sense tree (`senses[].translations[]`, `senses[].examples[]`) and the vocab's `topics[]` (sorted by slug) inlined. |
| GET | `/v1/vocabularies/:id` | none | Fetch a single **published** (approved) system vocabulary by UUID with all of its senses (each containing its own translations and examples) and its `topics[]` (sorted by slug). Returns 404 for unapproved drafts or non-system rows. Query: `translationLang` to restrict translations to one language. |

## My Vocabularies — `/v1/me/vocabularies`

Source: [src/vocabularies/me-vocabularies.controller.ts](../../src/vocabularies/me-vocabularies.controller.ts)

User-created (`source = 'user'`) words owned by the authenticated caller, always `visibility = 'private'`. They share storage with system vocabularies but are scoped to the owner — they don't appear on the public `/v1/vocabularies` surface. All endpoints require JWT auth; cross-user access returns 403. Two ways to create: the full `POST` (you supply senses; `is_approved = false`), or `quick-create` (lemma only → worker-enriched and `is_approved = true`).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/vocabularies` | JWT | Create a personal vocabulary. Body carries one or more `senses[]`, each with its own translations, examples, and `imageUrl`. Topic slugs (vocab-level) must already exist in the system catalog. Returns 409 if the caller already has a word for `(language, lemma, partOfSpeech)`. |
| POST | `/v1/me/vocabularies/quick-create` | JWT | Quick-create from just a lemma: body `{ lemma, language?, translationLanguage? }`. A background worker enriches it (dictionary + Gemma) into the caller's own private, **auto-approved** word(s) — one per resolved part of speech — and auto-generates audio. Returns `202` + the enrichment job to poll. Idempotent per (owner, language, lemma) pending job. |
| GET | `/v1/me/vocabularies/jobs/:jobId` | JWT | Poll one of the caller's own quick-create jobs: `{ id, language, lemma, status, resultVocabularyIds, error, createdAt, updatedAt }`. 404 if the job doesn't exist or isn't owned by the caller. |
| GET | `/v1/me/vocabularies/batches/:batchId` | JWT | Poll a bulk deck-import batch the caller started: `{ batchId, total, pending, completed, failed, resultVocabularyIds }`. 404 if the batch is unknown or not owned by the caller. |
| GET | `/v1/me/vocabularies` | JWT | List the caller's own vocabularies, newest first. Query: `language`, `q` (lemma prefix), `translationLang`, `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with senses and `topics[]` (sorted by slug) inlined. |
| GET | `/v1/me/vocabularies/:id` | JWT | Fetch one of the caller's vocabularies with all of its senses (each with translations and examples) and its `topics[]`. Query: `translationLang`. 403 if the row exists but isn't owned by the caller. |
| PATCH | `/v1/me/vocabularies/:id` | JWT | Partial update of top-level fields. Senses, translations, examples, and topic links are not patched here. |
| DELETE | `/v1/me/vocabularies/:id` | JWT | Hard-delete the caller's vocabulary. Cascades to its translations, examples, topic links, deck memberships, and progress rows. Returns 204. |

## Admin Vocabularies — `/v1/admin/vocabularies`

Source: [src/vocabularies/admin-vocabularies.controller.ts](../../src/vocabularies/admin-vocabularies.controller.ts)

Write surface for the curated system catalog. All endpoints require JWT auth **and** the caller's `role = 'admin'` (returns 403 otherwise). Each write runs in a transaction so partial failures roll back.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/admin/vocabularies` | JWT (admin) | List the **entire** vocabulary table (system + user) with admin-only fields (`visibility`, `isApproved`, `createdByUserId`, `createdAt`, `updatedAt`) inlined. Query: `language`, `cefrLevel` (A1–C2), `topic` (slug), `q` (lemma prefix), `source` (`system`/`user`), `isApproved` (`true`/`false`; empty = no filter), `visibility` (`system`/`private`/`public`), `createdByUserId` (uuid), `translationLang`, `sortBy` (`createdAt` default \| `frequencyRank`), `sortDir` (`asc` default \| `desc`), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }`; each row carries a top-level `imageUrl` (representative thumbnail — the first sense's image, or null) and `images` (all distinct sense images, ordered) plus the full sense tree and `topics[]` (sorted by slug) inlined. |
| POST | `/v1/admin/vocabularies` | JWT (admin) | Create one system vocabulary. Body carries one or more `senses[]` (each with translations, examples, and per-sense `imageUrl`) plus vocab-level topic links by slug. Returns 409 if `(language, lemma, partOfSpeech)` already exists — use bulk-import for upsert semantics. |
| POST | `/v1/admin/vocabularies/quick` | JWT (admin) | Quick-create from just a lemma. Body: `{ lemma, language?, translationLanguage? }` (language defaults to `en`; `translationLanguage` defaults to the configured target — `vi` — and is skipped when equal to `language`). Enqueues a background enrichment job (dictionary + Gemma) that lands one **unapproved draft** vocabulary per part of speech, each sense carrying a Gemma-produced translation in `translationLanguage`. Returns 202 with the job `{ id, status, resultVocabularyIds, error }`. Idempotent per `(language, lemma)`: an existing pending job is returned instead of starting a new one. |
| GET | `/v1/admin/vocabularies/quick/:jobId` | JWT (admin) | Poll a quick-create job. Returns `{ id, language, lemma, status, resultVocabularyIds, error, ... }`; `status` is `pending` → `completed`/`failed`. `resultVocabularyIds` holds the draft vocabularies created (empty while pending, or when every part of speech already existed). 404 if unknown. |
| POST | `/v1/admin/vocabularies/quick/extract` | JWT (admin) | Bulk quick-create phase 1 (stateless — no jobs). `multipart/form-data` with an optional `file` (`.txt`/`.csv`/`.xlsx`/`.pdf`, ≤5 MB) **or** a `text` field, plus `mode` (`list` default \| `prose`) and `language?` (default `en`). Parses the source into candidate lemmas, dedupes, drops words already in the catalog. Returns 200 `{ lemmas[], stats: { extracted, deduped, removedStopwords, alreadyInCatalog, capped } }` (capped at 1000 candidates). 400 if neither file nor text, or unsupported file type. |
| POST | `/v1/admin/vocabularies/quick/bulk` | JWT (admin) | Bulk quick-create phase 2. Body: `{ lemmas: string[] (1–500), language?, translationLanguage?, topics?: string[] }`. Creates one enrichment job per lemma under a shared `batchId`, skipping lemmas that already have a pending job or an existing system vocab. `translationLanguage` (defaults to the configured target — `vi` — skipped when equal to `language`) is applied to every lemma in the batch. When `topics` is given (slugs must exist, else 400), every created draft is linked to them and any skipped lemma already in the catalog is tagged in place (tag-on-skip). Returns 202 `{ batchId, accepted, skipped }` (`batchId` is null when everything was skipped). |
| GET | `/v1/admin/vocabularies/quick/batch/:batchId` | JWT (admin) | Poll a bulk batch. Returns `{ batchId, total, pending, completed, failed, resultVocabularyIds[] }` aggregated across the batch's jobs. 404 if the batch has no jobs. |
| GET | `/v1/admin/vocabularies/:id` | JWT (admin) | Read one system vocabulary by id, **including unapproved quick-create drafts** (unlike the public `GET /v1/vocabularies/:id`, which 404s on drafts). Query: `translationLang`. Returns the same admin shape as the list row — full sense tree, `topics[]`, `imageUrl`/`images`, plus `visibility`, `isApproved`, `createdByUserId`, `createdAt`, `updatedAt`. 404 if no system vocabulary with that id. Use this to populate the pre-approval edit screen. |
| POST | `/v1/admin/vocabularies/:id/approve` | JWT (admin) | Publish a draft system vocabulary: sets `isApproved = true` and enqueues audio (if missing) + image generation per sense without one. Idempotent. Returns 200 with the vocabulary. 404 if no system vocabulary with that id. |
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

Source: [src/topics/topics.controller.ts](../../src/topics/topics.controller.ts)

Public read access to the curated topic taxonomy used to tag vocabularies.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/topics` | none | List every topic, ordered by name. Returns a flat array (no pagination — set is small). |
| GET | `/v1/topics/:slug` | none | Fetch one topic by its slug (e.g. `food`, `travel`). Returns 404 if unknown. |

## Admin Topics — `/v1/admin/topics`

Source: [src/topics/admin-topics.controller.ts](../../src/topics/admin-topics.controller.ts)

Write surface for the topic taxonomy. All endpoints require JWT auth **and** `role = 'admin'` (403 otherwise).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/admin/topics` | JWT (admin) | Create a topic. Body: `{ slug, name, description?, iconUrl? }`. Slug must match `[a-z0-9-]+` (2–64 chars). Returns 409 if the slug already exists. |
| PATCH | `/v1/admin/topics/:slug` | JWT (admin) | Update `name`, `description`, or `iconUrl`. Slug itself is the identifier and not editable — to rename, DELETE then POST. |
| DELETE | `/v1/admin/topics/:slug` | JWT (admin) | Remove the topic. Cascades to `vocabulary_topics` (vocabularies stay, just lose this tag). Returns 204. |

## Decks — `/v1/decks` and `/v1/me/decks`

Source: [src/decks/decks.controller.ts](../../src/decks/decks.controller.ts)

Public catalog of system-curated learning decks, the community catalog of user decks published as `public`, plus the per-user "suggested for me" endpoint.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/v1/decks` | none | List system decks (those with `owner_id IS NULL`). Query: `language`, `cefrLevel` (A1–C2), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` with summary fields only — no vocab inlined. |
| GET | `/v1/decks/public` | none | List user decks published as `public` (`owner_id IS NOT NULL AND visibility='public'`), newest first. Same query params and response shape as `GET /v1/decks`. Declared before `/:id` so the literal path resolves first. |
| GET | `/v1/decks/:id` | none | Fetch one deck with its ordered vocabulary list (each vocab includes its senses → translations + examples). Serves only seeded (owner-less) decks and `public` user decks — a `private` deck returns 404 here (read it via `GET /v1/me/decks/:id`). Query: `translationLang` restricts the nested translations to one language. |
| GET | `/v1/me/decks/suggested` | JWT | Returns system decks matching the authenticated user's `targetLanguage` and `proficiencyLevel` from onboarding. Returns an empty array if either onboarding field is unset. |

## My Decks — `/v1/me/decks`

Source: [src/decks/decks.controller.ts](../../src/decks/decks.controller.ts)

Personal decks owned by the authenticated caller (`owner_id = me`, `visibility = 'private'` by default, or `'public'` once published). Membership accepts system vocabularies plus the caller's own (`source='user'`) words — other users' private words are dropped into `inaccessibleVocabularyIds`. All endpoints require JWT auth; cross-user access returns 403. Publishing a deck (`visibility='public'`) exposes its words — including the author's own user-words — to anyone via `GET /v1/decks/public` and `GET /v1/decks/:id`.

Route ordering note: `GET /v1/me/decks/suggested` is a literal path declared before `/:id`, so it resolves correctly. The collection endpoints below coexist with it.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/decks` | JWT | Create a personal deck. Body: `{ name, description?, language, cefrLevel?, vocabularyIds?, visibility? }`. `visibility` accepts `private` (default) or `public` — `system` is rejected. If `vocabularyIds` is provided, members are appended in array order (inaccessible IDs surfaced via the membership endpoint instead — for create they are silently skipped). Server sets `owner_id`, `vocab_count`. Returns the full deck detail. |
| POST | `/v1/me/decks/:id/clone` | JWT | Save a copy of a seeded or `public` deck into the caller's own decks as a fresh `private` deck (members copied by reference, order preserved). Another user's `private` deck returns 404. Returns 201 with the new deck detail. |
| GET | `/v1/me/decks` | JWT | List the caller's own decks, newest first. Query: `language`, `cefrLevel` (A1–C2), `page` (default 1), `limit` (default 20, max 100). Returns `{ data, page, limit, total }` — summary fields only. |
| GET | `/v1/me/decks/:id` | JWT | Fetch one of the caller's decks with its ordered vocabulary list. Query: `translationLang`. 403 if owned by someone else. |
| PATCH | `/v1/me/decks/:id` | JWT | Top-level updates only (`name`, `description`, `language`, `cefrLevel`, `visibility`). `visibility` toggles `private`/`public` (publish or unpublish); `system` is rejected. Membership has its own endpoints. |
| DELETE | `/v1/me/decks/:id` | JWT | Hard-delete the caller's deck. Cascades to `deck_vocabularies` (vocabularies themselves stay). Returns 204. |
| POST | `/v1/me/decks/:id/vocabularies` | JWT | Append words to the deck. Body: `{ vocabularyIds: string[] }` (1–500). Returns `{ added, alreadyMember, inaccessibleVocabularyIds, vocabCount }`. Positions are assigned after the current max. |
| POST | `/v1/me/decks/:id/bulk-import` | JWT | Bulk-import from a list of lemmas. Body: `{ lemmas: string[] (1–500), language?, translationLanguage? }`. Each new lemma is enriched into the caller's own word(s) and appended to this deck by the worker. Skips lemmas the caller already has pending or owns. Returns `202 { batchId, accepted, skipped }`; poll `GET /v1/me/vocabularies/batches/:batchId`. The deck fills in asynchronously as jobs complete. 403 if the deck isn't the caller's. |
| DELETE | `/v1/me/decks/:id/vocabularies/:vocabularyId` | JWT | Remove a word from the deck. 404 if it isn't in the deck. Returns 204. Decrements `vocab_count`. |

## Learn — `/v1/me/learn`

Source: [src/learn/learn.controller.ts](../../src/learn/learn.controller.ts)

Context-anchored learning sessions: the server picks due cards, expands each word into a **lesson ladder** of questions (easy→hard for the word's mastery stage), and HMAC-signs each item so answers can be graded statelessly. Twelve question types: flashcard (self-rated study card), cloze MCQ, cloze typing, meaning-in-context, sense disambiguation, listening cloze, word-from-translation (translation → pick lemma), translation-from-word (lemma → pick translation), listening-choice (audio → pick lemma), dictation (audio → type lemma), image-choice (image → pick lemma), pronunciation (speak the word; the client runs speech-to-text and submits the transcript). Which types a word gets is driven by its SRS stage (NEW = recognition band incl. the flashcard; LEARNING/REVIEW = recall + the hardest band; MASTERED = sense disambiguation only); styles requiring extra data (audio, a sense image, multiple senses, translation language) are skipped silently when unavailable, the cloze family is capped per lesson, and each band samples at most `LEARN_MAX_TYPES_PER_BAND` quiz types (default 2, flashcard exempt) so lessons stay short and vary across words. All endpoints require JWT auth.

`POST /v1/me/learn/session` is mode-driven — the caller picks one of `daily | topic | deck | review`. The server's `VocabPickerService` ([src/learn/vocab-picker.service.ts](../../src/learn/vocab-picker.service.ts)) selects suitable vocab for each mode; for `daily/topic/deck` it auto-enrolls fresh picks into the user's progress as a side effect (`enrolledNewlyCount` in the response says how many). `daily` and `topic` require onboarding to be complete (`targetLanguage` and `proficiencyLevel`), else 400.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/learn/session` | JWT | Build a session for a learning mode; each picked word expands into its lesson ladder, so `items[]` holds several questions per word. Body: `{ mode, topicSlug?, deckId?, limit?: 1–50 (default 15), translationLang? }`. `topicSlug` required iff `mode=topic`; `deckId` required iff `mode=deck`. Returns `{ sessionId, mode, enrolledNewlyCount, emptyReason, nextDueAt, items[] }`. Each item adds `groupId` (shared by all steps of one word), `stepIndex`, `stepCount` to the envelope. `emptyReason` is one of `no_due_cards | no_more_at_level | no_enrollment | deck_exhausted` (null when `items[]` is non-empty). `nextDueAt` is the ISO timestamp of the soonest future-scheduled card — populated only when `emptyReason='no_due_cards'`; null otherwise. Each item carries an HMAC signature + nonce + issuedAtMs (and the signed `stepIndex`/`stepCount`) the client echoes when submitting an answer. |
| POST | `/v1/me/learn/answer` | JWT | Submit one answer. Body: `{ vocabularyId, type, exampleId, stepIndex, stepCount, userAnswer, latencyMs, nonce, issuedAtMs, signature, translationLang? }`. `userAnswer` for `flashcard` is the self-rating (`forgot | hard | good | easy`); for MCQ types (`cloze_mcq`, `meaning_in_context`, `sense_disambiguation`, `word_from_translation`, `translation_from_word`, `listening_choice`, `image_choice`) it is the chosen option text; for typed types (`cloze_typing`, `dictation`) the typed text; for `pronunciation` the client-produced speech-to-text transcript (graded leniently against the lemma). Server verifies HMAC (30 min TTL), re-derives the correct answer, grades the response (SM-2 quality 0–5). A word's lesson is **one SRS event**: only the final step (`stepIndex === stepCount - 1`) updates progress; earlier steps grade for feedback only. Returns `{ correct, correctAnswer, quality, progress, requeue }`. `progress` is null on non-final steps. `requeue` is `{ dueAtMs, items[] }` (the word's next-stage ladder) when the card comes back within `LEARN_REQUEUE_WINDOW_MINUTES` (default 15); null otherwise. 401 if the signature is invalid or expired. |

## Practice — `/v1/me/practice`

Source: [src/practice/practice.controller.ts](../../src/practice/practice.controller.ts)

Open-production practice: the user writes (or speaks, via client speech-to-text) a sentence using a target word, and an LLM judge (Gemma 3 on Google AI Studio) scores it **asynchronously**. Scoring runs on a rate-limited BullMQ worker, so submit returns `202` immediately and the client polls for the result. The judge returns a rubric with an `overall` 0–100 score plus the CEFR level the sentence *demonstrates* (`A1`–`C2`) — this is the level of that one sentence, **not** the user's certified level. A per-user daily cap (`GEMMA_DAILY_ATTEMPTS_PER_USER`, default 30) bounds usage of the shared free key. All endpoints require JWT auth. See [docs/practice_submit_sentence.md](../frontend/practice_submit_sentence.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/practice/attempts` | JWT | Submit a sentence for scoring. Body: `{ vocabularyId, text (1–280 chars), modality: 'writing' \| 'speaking' }`. Creates a pending attempt and enqueues it. Returns `202 { attemptId, status: 'pending' }`. 404 if the vocabulary doesn't exist, 429 if the daily cap is reached, 503 if the scoring queue is unreachable. |
| GET | `/v1/me/practice/attempts/:id` | JWT | Poll for the result. Returns `{ id, vocabularyId, modality, text, status, score, cefr, rubric, feedback, error, createdAt, scoredAt }`. Scoring fields are null until `status='scored'`; `error` is set when `status='failed'`. 404 if the attempt isn't owned by the caller. |

Source: [src/progress/progress.controller.ts](../../src/progress/progress.controller.ts)

Per-user spaced-repetition state and study stats. All endpoints require JWT auth. Scheduling uses SM-2 ([src/progress/srs.ts](../../src/progress/srs.ts)) extended with Anki-style **learning steps**: new and lapsed cards cycle through minute-scale intervals (default `1m, 10m` via `LEARN_LEARNING_STEPS_MINUTES`) before graduating to the day-scale ladder. A card with `learningStepIndex !== null` is in step state; once past the final step it graduates to `intervalDays=1`, then `6`, then `interval * easeFactor`. After graduation `learning → review` follows 3 consecutive correct reps and `review → mastered` triggers when the interval reaches 90 days. A miss on a graduated card drops it back into step 0 (relearning).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/me/progress/enroll` | JWT | Add words to the caller's learning queue. Body: `{ vocabularyIds: string[] }` or `{ deckId: string }` (exactly one). Accepts system vocabularies plus the caller's own (`source='user'`) words — other users' private words are silently dropped into `unknownVocabularyIds`. Idempotent — already-enrolled words are skipped. Returns `{ enrolled, alreadyEnrolled, unknownVocabularyIds }`. |
| GET | `/v1/me/progress/due` | JWT | Fetch due cards (`next_review_at <= now`), oldest-due first. Query: `limit` (default 20, max 100), `translationLang` (filters nested translations). Each item includes the progress row and its full vocabulary (with senses → translations + examples). |
| POST | `/v1/me/progress/review` | JWT | Submit a review grade. Body: `{ vocabularyId, quality }` where quality is 0–5 (≥3 counts as correct). Runs SM-2; updates `repetitions`, `easeFactor`, `intervalDays`, `nextReviewAt`, status, and correct/incorrect counters. Returns the updated progress row. Returns 404 if the user is not enrolled in that word. |
| GET | `/v1/me/stats` | JWT | Snapshot for the home screen: `{ streakDays, dueNow, reviewedToday, dailyGoalMinutes, counts: { new, learning, review, mastered }, nextDueAt }`. Streak is consecutive UTC days with at least one review ending at the most recent review date (counts only if that date is today or yesterday). `nextDueAt` is the ISO timestamp of the soonest progress row scheduled in the future, or null when the user has no future-scheduled cards. |

## Pronunciation — `/v1/pronunciation`

Source: [src/pronunciation/pronunciation.controller.ts](../../src/pronunciation/pronunciation.controller.ts)

A thin proxy over the Python phoneme-scoring microservice (FastAPI `POST /score`, configured via `PRONUNCIATION_SERVICE_URL`). The learner uploads an audio clip of a target word; the service returns calibrated per-phoneme `0–100` scores (GOPT head) plus a coarse label per phone. Each call is persisted as a `pronunciation_attempt`. The decoder accepts **WAV/FLAC/OGG** only — browser `webm/opus` must be transcoded client-side first. All endpoints require JWT auth. See [docs/pronunciation_score.md](../frontend/pronunciation_score.md).

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/v1/pronunciation/score` | JWT | Score a pronunciation. `multipart/form-data`: `audio` (WAV/FLAC/OGG, ≤5 MB) + exactly one of `vocabularyId` (uuid) or `word` (1–128 chars). Forwards to the scoring service, stores the attempt, returns `{ attemptId, word, transcriptPhonemes, overallScore, phonemes[], audioQuality, modelVersion, createdAt }`. 404 if `vocabularyId` is unknown, 422 if the audio/word is unscorable (too short, no/unmapped phones), 503 if the scoring service is unreachable. |
| GET | `/v1/pronunciation/attempts` | JWT | The caller's attempt history, newest first. Query: `vocabularyId` (uuid), `word` (1–128 chars), `page` (default 1), `limit` (default 20, max 100). Returns `{ data: [{ id, vocabularyId, word, overallScore, phonemeScores[], modelVersion, createdAt }], page, limit, total }`. |
