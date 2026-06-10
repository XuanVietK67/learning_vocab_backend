# What a normal user can do — capability map (for the homepage redesign)

Everything a **signed-in, non-admin user** (`role = 'user'`) can do against this backend, grouped by area, with the endpoint behind each capability and a note on how it feeds the **homepage / dashboard**. Use this to decide what the new homepage surfaces.

- This is the **capability/overview** view. For exact request/response shapes, validation, and errors see [api-endpoints.md](../backend/api-endpoints.md) (the contract) and the per-feature docs linked below. Shared conventions (base URL, `Authorization: Bearer`, pagination, error shape) live in [frontend_handoff.md](frontend_handoff.md).
- **Admin-only** surfaces (`/v1/admin/*`) are intentionally excluded — a normal user can never reach them.
- 🆕 marks capabilities added in the latest work (activity heatmap, leaderboard, leaderboard opt-out) — these are the main drivers for the redesign.

---

## 1. Account & identity

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Sign up / sign in with email + password | `POST /v1/auth/register`, `POST /v1/auth/login` | Login is rate-limited. Returns `{ accessToken, refreshToken, user }`. |
| Sign in with a social provider | `POST /v1/auth/google`, `/v1/auth/apple`, `/v1/auth/github` | Same `{ accessToken, refreshToken, user }` shape. |
| Keep the session alive / sign out | `POST /v1/auth/refresh`, `POST /v1/auth/logout` | Refresh tokens rotate on every refresh — store the new one. |
| See who I am | `GET /v1/auth/me`, `GET /v1/users/:id` (self) | Full profile incl. `role`, `isOnboarded`, `isEmailVerified`, `avatarUrl`, `leaderboardOptOut`. |
| Edit my profile / finish onboarding | `PATCH /v1/users/:id` (self) | `nativeLanguage`, `targetLanguage`, `proficiencyLevel`, `dailyGoalMinutes`, `weeklyVocabGoal`, and 🆕 `leaderboardOptOut`. Setting all five onboarding fields flips `isOnboarded → true`. See [users_profile.md](users_profile.md). |
| Verify my email | `POST /v1/auth/email/send-verification`, `POST /v1/auth/email/verify` | 6-digit code, 60s resend cooldown. |

**Homepage relevance:** greet by `username`/`avatarUrl`; show an **onboarding nudge** if `!isOnboarded` (daily & topic learning are blocked until then) and an **email-verify nudge** if `!isEmailVerified`.

## 2. Browse content (catalog)

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Browse the system vocabulary catalog | `GET /v1/vocabularies`, `GET /v1/vocabularies/:id` | Public. Filters: `language`, `cefrLevel`, `topic`, `q` (prefix), `translationLang`; paginated. Full sense tree inlined. |
| Browse topics | `GET /v1/topics`, `GET /v1/topics/:slug` | Public, flat list. |
| Browse system decks | `GET /v1/decks`, `GET /v1/decks/:id` | Public curated decks. |
| Browse community (public) decks | `GET /v1/decks/public` | User-published decks, newest first. |
| Get decks suggested for me | `GET /v1/me/decks/suggested` | Matches my `targetLanguage` + `proficiencyLevel`; empty until onboarded. |

**Homepage relevance:** a **"Suggested for you"** deck rail (`/v1/me/decks/suggested`), plus entry points into the catalog and community decks.

## 3. My vocabulary (personal words)

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Add a word with full detail | `POST /v1/me/vocabularies` | You supply senses/translations/examples. |
| Quick-add a word from just a lemma | `POST /v1/me/vocabularies/quick-create` → poll `GET /v1/me/vocabularies/jobs/:jobId` | Async (`202`); a worker enriches + auto-approves + generates audio. See [me_vocabulary_quick_create.md](me_vocabulary_quick_create.md). |
| List / read / edit / delete my words | `GET /v1/me/vocabularies`, `GET /:id`, `PATCH /:id`, `DELETE /:id` | Private to me. |

**Homepage relevance:** a **"My words"** count / quick-add CTA.

## 4. My decks (lists)

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Create a deck | `POST /v1/me/decks` | Optional starter `vocabularyIds`, `visibility` (`private` default / `public`). |
| Clone a system or public deck | `POST /v1/me/decks/:id/clone` | Copies into my decks as `private`. |
| List / read / edit / delete my decks | `GET /v1/me/decks`, `GET /:id`, `PATCH /:id`, `DELETE /:id` | `PATCH` can publish/unpublish via `visibility`. |
| Add / remove words | `POST /v1/me/decks/:id/vocabularies`, `DELETE /v1/me/decks/:id/vocabularies/:vocabularyId` | |
| Bulk-import words from a lemma list | `POST /v1/me/decks/:id/bulk-import` → poll `GET /v1/me/vocabularies/batches/:batchId` | Async; deck fills in as jobs finish. See [decks_bulk_import.md](decks_bulk_import.md). |
| Publish / clone (community) | `PATCH visibility=public`, `POST /clone` | See [decks_share_and_clone.md](decks_share_and_clone.md). |

**Homepage relevance:** a **"My decks"** rail and a **create-deck** quick action.

## 5. Learn (the core loop)

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Enroll words/decks into my study queue | `POST /v1/me/progress/enroll` | By `vocabularyIds` or `deckId`. (Learn sessions also auto-enroll.) |
| Get cards due now | `GET /v1/me/progress/due` | Oldest-due first, full vocab inlined. |
| Start a guided learn session | `POST /v1/me/learn/session` | Modes: `daily` / `topic` / `deck` / `review`. `daily` & `topic` require onboarding. |
| Answer questions | `POST /v1/me/learn/answer` | 12 question types incl. flashcard, cloze, listening, pronunciation. See [learn_vocabulary_flow.md](learn_vocabulary_flow.md) + [learn_session_ui_flow.md](learn_session_ui_flow.md). |
| Submit a single review grade directly | `POST /v1/me/progress/review` | SM-2 update; 🆕 also logs one `learning_activity` event (feeds streak/heatmap/leaderboard). |

**Homepage relevance:** the **primary CTA** — "Continue learning" / "Study N due cards" driven by `dueNow` + `nextDueAt` (see §7).

## 6. Practice & pronunciation

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Get an LLM-scored sentence I wrote/spoke | `POST /v1/me/practice/attempts` → poll `GET /v1/me/practice/attempts/:id` | Async; daily cap. Returns score + CEFR + rubric. See [practice_submit_sentence.md](practice_submit_sentence.md). |
| Score my pronunciation of a word | `POST /v1/pronunciation/score` | Per-phoneme scores (WAV/FLAC/OGG). See [pronunciation_score.md](pronunciation_score.md). |
| Review my pronunciation history | `GET /v1/pronunciation/attempts` | Paginated, newest first. |

**Homepage relevance:** secondary practice CTAs / "Try speaking a word".

## 7. Progress, streak & activity 🆕

| Capability | Endpoint(s) | Notes |
|---|---|---|
| Home-screen stats snapshot | `GET /v1/me/stats` | `{ streakDays, dueNow, reviewedToday, dailyGoalMinutes, counts: { new, learning, review, mastered }, nextDueAt }`. |
| 🆕 Activity heatmap (contribution calendar) | `GET /v1/me/activity` | Per-day `reviews` + `newWords` over a date range, bucketed by the device `tz`; plus `totalReviews`, `totalNewWords`, `activeDays`, `maxReviews`. See [me_activity_heatmap.md](me_activity_heatmap.md). |

**Homepage relevance:** this is the **heart of the redesign** — streak counter, daily-goal progress (`reviewedToday` vs `dailyGoalMinutes`), the status breakdown donut (`counts`), the "next review in …" hint (`nextDueAt`), and the **GitHub-style heatmap** (`/v1/me/activity`).

## 8. Community & social 🆕

| Capability | Endpoint(s) | Notes |
|---|---|---|
| 🆕 See the leaderboard + my rank | `GET /v1/leaderboard` | `metric=words_mastered` (all-time) is **live**; `metric=new_words` (weekly/monthly) returns **501** until the activity log accrues (Phase 2). Always returns `me: { rank, value }`. See [community_leaderboard.md](community_leaderboard.md). |
| 🆕 Opt out of the leaderboard | `PATCH /v1/users/:id` → `leaderboardOptOut: true` | Removed from everyone's board + rank denominator; still sees own `me`. |
| Publish / share decks | `PATCH /v1/me/decks/:id visibility=public`, `GET /v1/decks/public`, `POST /clone` | The existing community surface. |

**Homepage relevance:** a **leaderboard snapshot** card — "You're #87 · 14 words mastered" from `me`, plus the top 3 — with a link to the full board.

---

## Homepage redesign — what to surface (recommended)

Driven mostly by **two** cheap calls on load: `GET /v1/me/stats` and `GET /v1/me/activity`, plus `GET /v1/leaderboard` for the social card.

| Section | Data source | Notes |
|---|---|---|
| **Greeting / header** | `GET /v1/auth/me` | `username`, `avatarUrl`. |
| **Streak + daily goal** | `/me/stats` → `streakDays`, `reviewedToday`, `dailyGoalMinutes` | Ring/progress against the daily goal; flame for streak. |
| **Primary CTA: Continue learning** | `/me/stats` → `dueNow`, `nextDueAt` | `dueNow > 0` → "Study N cards" (starts `mode=daily`/`review`); else "Next review in …" from `nextDueAt`. |
| **🆕 Activity heatmap** | `/me/activity?tz=<device>` | Year grid; `totalReviews` headline; intensity from `maxReviews`. |
| **Progress breakdown** | `/me/stats` → `counts {new,learning,review,mastered}` | Donut/segmented bar. |
| **🆕 Leaderboard snapshot** | `/leaderboard?metric=words_mastered` | Show `me.rank`/`me.value` + top 3; link to full board. Hide/replace if opted out (`me.rank: null`). |
| **Suggested decks** | `/me/decks/suggested` | Empty until onboarded → swap for an onboarding card. |
| **Quick actions** | (navigation) | Add word, browse catalog, create deck, practice, pronounce. |
| **Onboarding / verify nudges** | `auth/me` → `isOnboarded`, `isEmailVerified` | Conditional banners. |

### Empty / gated states to design
- **Not onboarded** (`isOnboarded=false`): `daily`/`topic` learning and suggested decks are unavailable — lead with an onboarding card instead of the study CTA.
- **No activity yet**: `/me/activity` returns `totalReviews:0, days:[]`; `/me/stats` shows `streakDays:0, dueNow:0`. Show a "Start learning to light up your calendar" empty state.
- **Opted out of leaderboard** (`me.rank: null` with a non-zero history, or `leaderboardOptOut=true`): show an "Appear on leaderboard" prompt instead of a rank.
- **`new_words` board** returns `501` today — gate that toggle as "coming soon".

> Keep this file current: when a normal-user endpoint is added/removed or its purpose changes, update the matching row here in the same PR (alongside [api-endpoints.md](../backend/api-endpoints.md)).
