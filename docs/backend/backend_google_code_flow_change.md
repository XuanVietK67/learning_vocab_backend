# Backend change request — Google sign-in: switch `/v1/auth/google` to the authorization-code flow

**Audience:** backend team (NestJS API on Railway).
**Endpoint affected:** `POST /v1/auth/google` (public, no auth).
**TL;DR:** the frontend now sends `{ code }` (a Google OAuth authorization code) instead of `{ idToken }`. The backend must exchange that code with Google for tokens, then verify the resulting `id_token` using the logic it already has. One new env var (`GOOGLE_CLIENT_SECRET`) is required.

---

## 1. Why this is changing

The frontend used Google Identity Services' `renderButton`, which returns an `id_token` (`credential`) directly. That button is **locked to Google's own styling** and cannot be restyled to match our UI. The previous workaround — rendering Google's button transparently (`opacity: 0`) on top of our custom button — is blocked by Google's **anti-clickjacking protection**: on a real public origin the overlaid button is silently **inert** (clicking does nothing, no error), even though it works on `localhost`. This was the production bug: "Continue with Google" did nothing on the deployed site.

To keep our custom button **and** have a reliable flow, the frontend switched to the **OAuth 2.0 authorization-code popup flow** (`google.accounts.oauth2.initCodeClient`). Our button opens a Google popup, the user picks an account, and Google returns an **authorization `code`** to the frontend. The frontend forwards that code to `POST /v1/auth/google`. The backend must exchange it.

> The `code` is **not** an `id_token` and **not** an access token — it's a short-lived, single-use authorization code that must be exchanged server-side (it requires the client secret, which must never live in the browser).

---

## 2. New request contract

### Before
```json
POST /v1/auth/google
{ "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..." }
```

### After
```json
POST /v1/auth/google
{ "code": "4/0AeanS0b...." }
```

| Field | Required | Type | Notes |
|---|---|---|---|
| `code` | yes | string | Google OAuth authorization code from the GIS popup flow. Single-use, short-lived. |

**Recommended rollout:** accept **both** `{ code }` and the legacy `{ idToken }` for one release so frontend/backend can deploy independently, then drop `idToken`. If you only accept one shape, see **§7 deploy order**.

The **200 response** (`AuthResponse`) and **all error codes** are unchanged (see §6).

---

## 3. What the backend must do

### Step 1 — Exchange the code with Google

`POST` to Google's token endpoint, form-urlencoded:

```http
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

code=<code from request body>
&client_id=<GOOGLE_CLIENT_ID>
&client_secret=<GOOGLE_CLIENT_SECRET>
&redirect_uri=postmessage
&grant_type=authorization_code
```

- **`redirect_uri` must be the literal string `postmessage`.** The frontend uses `ux_mode: 'popup'`; for the popup code flow the exchange uses `postmessage` rather than a registered redirect URL. (Do **not** register `postmessage` in the Console — see §5.)
- `client_id` is the **same** client ID already configured (`GOOGLE_CLIENT_ID`).
- `client_secret` is **new** — see §4.

**Successful token response from Google** (relevant fields):
```json
{
  "access_token": "ya29....",
  "expires_in": 3599,
  "scope": "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
  "token_type": "Bearer",
  "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij..."
}
```

The frontend requests scope `openid email profile`, so the response **includes an `id_token`**. That is the JWT you already know how to verify.

If Google returns a non-200 here (e.g. `invalid_grant` — code expired, reused, or wrong `redirect_uri`/secret), treat it as a rejected token → respond `401` (see §6).

### Step 2 — Verify the `id_token` and issue the session (reuse existing logic)

Take `id_token` from the token response and run the **exact same verification + user logic you already have** for the old flow:

1. Verify the JWT with Google (signature, issuer, expiry) and that **`aud` == `GOOGLE_CLIENT_ID`**.
2. Read the claims: `sub`, `email`, `email_verified`, `name`, `picture`.
3. Reject if `email_verified` is false → `401 google email not verified`.
4. Look up / link / create the user:
   - existing Google user (`sub`) → log in;
   - existing email/password user with the **same email** → link Google to that account, log in;
   - brand-new email → create the account (`username: null`, `isOnboarded: false`, languages/goals `null`, `avatarUrl` from `picture` if present).
5. Issue and return the normal `AuthResponse` (access + refresh tokens + user) — **identical to `/login`**.

Nothing about session/token issuance changes — only how the `id_token` is obtained (exchange a `code` instead of receiving it directly).

> We do **not** need offline access or a Google refresh token — this is one-shot authentication. No need to store Google tokens.

---

## 4. New environment variable

| Var | Where to get it | Notes |
|---|---|---|
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → **APIs & Services → Credentials → Clients → (your Web client) → Client secret** | Same OAuth client as `GOOGLE_CLIENT_ID`. **Server-side only** — never expose to the browser. Add to the Railway env. |

`GOOGLE_CLIENT_ID` is unchanged. If `GOOGLE_CLIENT_SECRET` is unset, the endpoint should return `503` (same as today's "not configured" case).

---

## 5. Google Cloud Console config

- **No new redirect URI to register.** The popup code flow uses only the existing **Authorized JavaScript origins** (the deployed frontend origin, e.g. `https://learningvocabulary.vercel.app`). `postmessage` is a special value used only in the server-side exchange and is not added to "Authorized redirect URIs".
- Confirm the deployed frontend origin is present under **Authorized JavaScript origins** (it already is).

---

## 6. Error mapping (unchanged from the current contract)

| Status | When | `message` (example) |
|---|---|---|
| `400` | `code` missing / not a string / empty, or body has invalid fields | `["code should not be empty"]` |
| `401` | Google rejected the exchange or the `id_token` (expired/reused code, wrong audience, malformed) | `invalid google token` |
| `401` | Verified but missing `sub`/`email` | `invalid google token payload` |
| `401` | Google email not verified | `google email not verified` |
| `401` | Matched account is disabled (`isActive: false`) | `account is disabled` |
| `503` | `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` not configured | `google sign-in not configured` |

### 200 OK — `AuthResponse` (unchanged)
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

---

## 7. Deploy order (important)

The frontend now sends `{ code }`. To avoid breaking sign-in during the rollout:

1. **Deploy the backend first.** Ideally make it accept **both** `{ code }` and `{ idToken }` for one release.
2. Then deploy the frontend (already sends `{ code }`).
3. Once the frontend is live and verified, drop the legacy `{ idToken }` path.

If the backend is **not** updated first, a frontend `{ code }` request hits a backend that requires `{ idToken }` → `400`, and Google sign-in is down.

---

## 8. Quick verification checklist

- [ ] `GOOGLE_CLIENT_SECRET` set in the backend (Railway) env.
- [ ] `POST /v1/auth/google` accepts `{ code }`.
- [ ] Code exchange uses `grant_type=authorization_code` + `redirect_uri=postmessage`.
- [ ] `id_token` from the exchange is verified with `aud == GOOGLE_CLIENT_ID`.
- [ ] New Google user → created with `isOnboarded: false`; returning user → logs in; same-email password user → linked.
- [ ] Errors map per §6 (`invalid_grant` → 401; missing secret → 503).
- [ ] End-to-end: click "Continue with Google" on the deployed frontend → popup → land authenticated.

---

## 9. cURL sanity test (optional, backend-side)

You can't easily mint a real `code` by hand (it comes from the browser popup), but you can confirm the exchange wiring with a fresh code captured from the frontend:

```bash
curl -s https://oauth2.googleapis.com/token \
  -d code="<paste a fresh code>" \
  -d client_id="$GOOGLE_CLIENT_ID" \
  -d client_secret="$GOOGLE_CLIENT_SECRET" \
  -d redirect_uri="postmessage" \
  -d grant_type="authorization_code"
```

A 200 with an `id_token` field confirms client ID + secret + `redirect_uri=postmessage` are correct. (Codes are single-use — re-running with the same code returns `invalid_grant`.)
