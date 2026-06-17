# Sign in with Google

**`POST /v1/auth/google`** — No auth (public). Returns the same session as `/login` (access + refresh tokens + user).

Lets a user sign in or sign up with their real Google account (Gmail). This sits **alongside** email/password login — it does not replace `POST /v1/auth/register` / `POST /v1/auth/login`. A user can have both: if someone registered with email/password and later signs in with the same Gmail, the backend links the Google identity to that existing account automatically.

---

## Recommended login screen layout

Keep both methods, but make **Google the primary CTA** and demote email/password to a secondary "or continue with email" option. Google sign-in needs no password, so this gives the clean, password-free UX for almost everyone while keeping email/password as a fallback for admins, demos, tests, and non-Gmail accounts.

```
┌─────────────────────────────────┐
│   [G]  Continue with Google      │   ← primary, full-width button
└─────────────────────────────────┘

           ──  or  ──

  Email     [_____________________]
  Password  [_____________________]
  [ Sign in ]                          ← secondary
  Don't have an account? Register
```

Guidance:
- Put the Google button **first and prominent**; render it with the GIS SDK (see integration sketch below).
- The email/password form is the secondary path — smaller, below the divider. Don't give it equal visual weight.
- Use the same layout on both the sign-in and sign-up screens.
- Do **not** require a password from Google users — they never set one (their `passwordHash` stays `null`).

---

## How the flow works (end to end)

1. Frontend renders a "Sign in with Google" button using **Google Identity Services (GIS)**.
2. The user picks their Google account; GIS returns a **Google ID token** (a JWT credential string) to the frontend. The frontend never sees the user's Google password.
3. Frontend `POST`s that ID token to `POST /v1/auth/google`.
4. Backend cryptographically verifies the token with Google, then:
   - existing Google user → logs them in;
   - existing email/password user with the **same email** → links Google to that account and logs them in;
   - brand-new email → creates a new account.
5. Backend returns the normal `AuthResponse` (access token + refresh token + user). From here, the frontend treats the session identically to an email/password login.

> The ID token is what GIS calls the **`credential`**. It is *not* an OAuth access token and *not* the authorization `code` flow — use the One Tap / button credential flow.

---

## Prerequisites (one-time, shared with backend)

- A Google OAuth **Web application** Client ID must exist (Google Cloud Console → APIs & Services → Credentials).
- The frontend origin (`http://localhost:3000` for dev, plus the deployed URL) must be listed under the client's **Authorized JavaScript origins**, or GIS refuses to render.
- The **same** Client ID is configured on both sides:
  - Backend: `GOOGLE_CLIENT_ID` env var (the backend rejects tokens whose audience isn't this client).
  - Frontend: e.g. `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.
- If the backend's `GOOGLE_CLIENT_ID` is unset, this endpoint returns **503** (see error table).

---

## Request

### Headers

```
Content-Type: application/json
```

No `Authorization` header — this endpoint is public.

### Body

```json
{ "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..." }
```

### Field rules

| Field | Required | Type | Constraints |
|---|---|---|---|
| `idToken` | yes | string | min length 20. The raw Google ID token (`credential`) string from GIS. No other body fields are allowed (extra fields → `400`). |

---

## Response

### 200 OK — `AuthResponse`

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "f0e1d2c3-b4a5-6789-0123-456789abcdef",
  "user": {
    "id": "9d8c7b6a-5e4f-4a3b-2c1d-0e9f8a7b6c5d",
    "email": "alice@gmail.com",
    "username": null,
    "avatarUrl": "https://lh3.googleusercontent.com/a/...",
    "role": "user",
    "isEmailVerified": true,
    "isActive": true,
    "isOnboarded": false,
    "nativeLanguage": null,
    "targetLanguage": null,
    "proficiencyLevel": null,
    "dailyGoalMinutes": null,
    "weeklyVocabGoal": null,
    "leaderboardOptOut": false,
    "createdAt": "2026-06-17T08:30:00.000Z",
    "updatedAt": "2026-06-17T08:30:00.000Z"
  }
}
```

- Store `accessToken` and send it as `Authorization: Bearer <accessToken>` on authenticated calls (default lifetime `15m`).
- Store `refreshToken` and rotate it via `POST /v1/auth/refresh` (default lifetime `30d`; a new refresh token is returned on every refresh — replace the stored one immediately).
- The `user` object is the same `UserResponse` returned by `GET /v1/auth/me`. See [auth_session_tokens.md](auth_session_tokens.md) for the full session/token lifecycle.

### Errors

| Status | When | `message` (example) |
|---|---|---|
| `400` | `idToken` missing, not a string, shorter than 20 chars, or body has extra fields | `["idToken must be longer than or equal to 20 characters"]` |
| `401` | Google rejected the token (expired, wrong audience, malformed) | `invalid google token` |
| `401` | Token verified but missing `sub`/`email` | `invalid google token payload` |
| `401` | The Google account's email is not verified | `google email not verified` |
| `401` | The matched account is disabled (`isActive: false`) | `account is disabled` |
| `503` | Backend has no `GOOGLE_CLIENT_ID` configured | `google sign-in not configured` |

---

## What the frontend must do

### 1. Load Google Identity Services and get an ID token

Use the official GIS web SDK (`https://accounts.google.com/gsi/client`). Either render the Google button or use One Tap. On success you get a `credential` — that string is the `idToken`.

Sketch (vanilla; adapt to your React setup):

```js
google.accounts.id.initialize({
  client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  callback: async ({ credential }) => {
    const res = await fetch(`${API_BASE}/v1/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: credential }),
    });
    if (!res.ok) {
      // surface the error message from the body
      return;
    }
    const session = await res.json(); // AuthResponse
    saveTokens(session.accessToken, session.refreshToken);
    routeAfterLogin(session.user);
  },
});
google.accounts.id.renderButton(buttonEl, { theme: 'outline', size: 'large' });
```

### 2. Store the session and reuse it

Persist `accessToken` + `refreshToken` exactly as you do for email/password login. Nothing about the session differs by login method.

### 3. Handle onboarding for new Google users — **important**

A first-time Google sign-up is created with:

- `username: null`
- `isOnboarded: false`
- language/goal fields all `null`

So after a successful Google sign-in, **check `user.isOnboarded`**:

- `false` → route the user into the onboarding flow to collect a username + language settings (same screens used after `POST /v1/auth/register`), then `PATCH /v1/users/:id` to complete it (see [users_profile.md](users_profile.md)).
- `true` → go straight to the app home.

Returning users who already onboarded will come back with `isOnboarded: true` and their previous `username`, so don't force onboarding again.

### 4. Keep email/password login available

This button is additive. Leave the existing email/password form in place. Users who created an account with a password keep it; signing in with the same Gmail just links Google to that account — it does not remove their password.

---

## Notes / gotchas

- **Email must be verified on Google's side.** Google accounts almost always have verified emails, but the backend rejects unverified ones with `401 google email not verified`.
- **`username` can be `null`** for social accounts until onboarding sets it — don't assume it's present when rendering the profile.
- **`avatarUrl`** is populated from the Google profile picture when available; it may be `null`.
- This is a stateless verification — there is no Google redirect/callback URL to register for this flow, just the JS origin.
- Related providers using the identical contract: `POST /v1/auth/apple` (`{ idToken, fullName? }`) and `POST /v1/auth/github` (`{ code }`).
