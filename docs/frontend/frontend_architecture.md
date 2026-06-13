# Frontend architecture overview

Reference description of the **client application** that consumes this backend's
`/v1` API. The frontend is a **separate repository/project** (Next.js), checked
out next to the backend during development at `../frontend_v2`. It is **not** a
submodule of this repo — it talks to the backend purely over the documented HTTP
API and never touches the database directly.

This doc is the source for the report's frontend coverage
([Chuong3 §Công nghệ Frontend](../report/Chuong/Chuong3.tex),
[Chuong4 §Hiện thực hoá tầng giao diện người dùng](../report/Chuong/Chuong4.tex)).
Keep it in sync when the frontend's architecture changes.

## Stack

| Concern | Choice |
| --- | --- |
| Framework | **Next.js 16** (App Router), dev port `3001` |
| UI library | **React 19**, TypeScript strict |
| Styling | **Tailwind CSS v4** (CSS-first config, no `tailwind.config.js`) |
| Components | **shadcn/ui** on **Base UI** (`@base-ui/react`) primitives |
| Validation | **zod v4** (shared client + server) |
| Misc | `next-themes` (light/dark), `sonner` (toasts), `lucide-react` (icons), `input-otp` (email verification) |

## Architecture principle — server-first

Most screens are **Server Components** that fetch on the server; all writes go
through **Server Actions**. Consequence: access/refresh tokens live only on the
server and never reach browser JS.

## Project structure (route groups)

```
src/app/
  (auth)/      login, register, verify-email      — its own layout
  (app)/       dashboard, learn, explore, decks,  — the learner experience
               practice, community, leaderboard,
               profile, settings, words
  (admin)/     admin vocabulary/topic/user mgmt   — admin-only surface
  onboarding/  first-run profile wizard
```

Route groups (parenthesised folders) don't appear in the URL; they give each
area its own `layout.tsx` and guards. Each segment uses App Router special
files — `layout.tsx`, `loading.tsx` (Suspense), `error.tsx` (segment error
boundary), `not-found.tsx`. Route-specific components are colocated; only shared
ones are promoted to `src/components/`.

## API integration — `src/lib/api.ts`

Server-only HTTP client (importing `next/headers` makes it server-only). Backend
URL comes from `API_BASE_URL` (no `NEXT_PUBLIC_` prefix, so it stays
server-side; defaults to `http://localhost:3000`).

- `apiRequest(path, init, token?)` — **unauthenticated** calls (login, register,
  refresh). Sets JSON `Content-Type`, or lets the runtime set the multipart
  boundary when the body is `FormData` (file uploads). `cache: "no-store"`.
- `authedRequest(path, init)` — attaches the access token and, on `401`,
  **transparently rotates the refresh token once and retries**. Only safe from a
  Server Action / Route Handler (it writes cookies).

Both normalise NestJS error bodies into a uniform `ApiResult<T>`
(`{ ok, status, data, error }`), so callers branch on **return values**, not
exceptions. `firstMessage()` pulls the first human-readable string from a Nest
error body (`message` may be a string or string[]).

## Session & auth — `src/lib/auth/`

Tokens are stored in **httpOnly cookies** matching the backend contract:

| Cookie | Max-age | Notes |
| --- | --- | --- |
| `access_token` | 15 min | matches `JWT_ACCESS_EXPIRES_IN` |
| `refresh_token` | 30 days | rotated on every `/v1/auth/refresh` |
| `user_id` | 30 days | convenience for owner-scoped calls |

Cookie flags: `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`.
`session.ts` imports `next/headers` → server-only by construction (pulling it
into a Client Component is a build error — the intended guard).

Post-auth redirect (`(auth)/actions.ts` → `homeFor`): admins → `/admin`,
onboarded learners → `/dashboard`, otherwise → `/onboarding`. On a lingering
`401` after refresh, the session is cleared and the user is sent to `/login`.

## Validation — `src/lib/validations/`

One `zod` schema per form (`auth.ts`, `learn.ts`, `topic.ts`, `user.ts`,
`vocabulary.ts`), reused for client-side checks and re-validated inside the
Server Action (`safeParse` → `fieldErrorsFrom`). Never trust the client.

## Learn engine — `src/app/(app)/learn/`

- **`session-machine.ts`** — pure reducer for the question queue. Framework- and
  network-free, unit-testable in isolation. Holds the remaining `queue`
  (`queue[0]` is on screen), `answeredCount`/`correctCount`, and the terminal
  status: `loading | active | empty | done | expired | error`. Cards that need
  to repeat within a session are **requeued to the back** (no wall-clock timer
  in v1).
- **`actions.ts`** — Server Actions `startSessionAction` /
  `submitAnswerAction` → `POST /v1/me/learn/session` and `/answer`, both via
  `authedRequest`. `translationLang` is derived server-side from the user's
  onboarding `nativeLanguage`.
- Because the backend **HMAC-signs** each question, a `401` that survives a
  token refresh means the question signature expired/was tampered → the UI moves
  to `expired` and invites a fresh session.
- **`questions/`** — one component per question mode (flashcard, cloze MCQ/typing,
  dictation, image/listening choice, listening cloze, meaning-in-context,
  pronunciation, sense disambiguation, translation↔word). Recording uses
  `_shared/use-wav-recorder.ts` and `_shared/use-speech-recognition.ts`.

## Screen → API mapping

See [Chuong2 Table — Ánh xạ giữa màn hình giao diện và API](../report/Chuong/Chuong2.tex)
for the screen-to-endpoint mapping, and [docs/backend/api-endpoints.md](../backend/api-endpoints.md)
for the authoritative endpoint contract.
