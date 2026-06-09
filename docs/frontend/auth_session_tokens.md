# Auth — login session, access & refresh tokens (frontend guide)

How a client establishes and maintains a session: get a token pair (register / login / social), call protected endpoints with the **access token**, and use the **refresh token** to stay signed in without re-entering credentials. Covers token lifetimes, rotation, and logout.

**Content type** `application/json`. These endpoints are public except `GET /auth/me` and `logout`/`refresh` semantics noted below.

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /v1/auth/register` | none | Create an email+password account and get the first token pair. |
| `POST /v1/auth/login` | none | Email+password login (rate-limited). Returns a token pair. |
| `POST /v1/auth/refresh` | refresh token in body | Exchange a refresh token for a **new** pair (rotation). |
| `POST /v1/auth/logout` | refresh token in body | Revoke a refresh token. |
| `GET /v1/auth/me` | access token | Get the current user. |
| `POST /v1/auth/{google,apple,github}` | none | Social sign-in; returns the same token pair. |

Canonical contract: [api-endpoints.md](../backend/api-endpoints.md) · conventions: [frontend_handoff.md](frontend_handoff.md)

---

## The two tokens

| | Access token | Refresh token |
|---|---|---|
| **Format** | JWT (signed) | opaque random string (~64 chars) |
| **Default lifetime** | **15 minutes** (`JWT_ACCESS_EXPIRES_IN`) | **30 days** (`JWT_REFRESH_EXPIRES_IN`) |
| **Sent as** | `Authorization: Bearer <accessToken>` on every protected request | inside the JSON body of `/auth/refresh` and `/auth/logout` |
| **Server stores it?** | No (stateless — validity = signature + expiry) | Yes (only a SHA-256 **hash**; the raw value is shown once, in the response) |
| **Rotated?** | Re-issued on every login/refresh | **Yes — single-use.** Each `/refresh` revokes the presented one and issues a new one |

**Store both client-side** (the access token for the auth header, the refresh token to renew). Treat the refresh token like a password.

---

## Token pair response (`AuthResponse`)

`register`, `login`, `refresh`, and all social endpoints return the same shape:

```jsonc
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "QxV3c...base64url...48-bytes",
  "user": {
    "id": "8f1d2c34-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
    "email": "alice@example.com",
    "username": "alice_99",
    "avatarUrl": null,
    "role": "user",
    "isEmailVerified": false,
    "isActive": true,
    "isOnboarded": false,
    "nativeLanguage": null,
    "targetLanguage": null,
    "proficiencyLevel": null,
    "dailyGoalMinutes": null,
    "weeklyVocabGoal": null,
    "createdAt": "2026-06-03T08:00:00.000Z",
    "updatedAt": "2026-06-03T08:00:00.000Z"
  }
}
```

---

## Session lifecycle

```
   register / login / social
          │  → { accessToken, refreshToken, user }
          ▼
   store both tokens
          │
          ▼
   call protected endpoints with  Authorization: Bearer <accessToken>
          │
          ├─ 200 → use the response
          │
          └─ 401 (access token expired, ~15 min) ─────────────┐
                                                              ▼
                                          POST /v1/auth/refresh { refreshToken }
                                                  │
                                   ┌──────────────┴───────────────┐
                                   ▼                              ▼
                            200 → NEW pair                 401 → refresh invalid/expired/reused
                            replace BOTH stored tokens     clear session → send to login
                            retry the original request
          │
          ▼
   logout → POST /v1/auth/logout { refreshToken } → 204, then drop tokens client-side
```

**Recommended client rule:** wrap your HTTP layer so a `401` on any protected call triggers **one** `/refresh` attempt, then retries the original request with the new access token. If `/refresh` itself returns `401`, the session is dead — clear stored tokens and route to login. Never loop refresh.

---

## Endpoints

### `POST /v1/auth/register` → `201`

```jsonc
{ "email": "alice@example.com", "password": "correct horse battery staple", "username": "alice_99" }
```

| Field | Rule |
|---|---|
| `email` | valid email, ≤255 chars |
| `password` | 8–72 chars |
| `username` | 3–30 chars, `^[a-zA-Z0-9_]+$` |

Returns `AuthResponse`. `409` if the email/username is already taken.

### `POST /v1/auth/login` → `200`

```jsonc
{ "email": "alice@example.com", "password": "correct horse battery staple" }
```

`password`: 1–72 chars. Returns `AuthResponse`. **Rate-limited per IP: 5 attempts / 15 min** → `429` when exceeded. Wrong credentials or a disabled account → `401 invalid credentials` (the same message either way, on purpose).

### `POST /v1/auth/refresh` → `200`

```jsonc
{ "refreshToken": "QxV3c...base64url..." }
```

`refreshToken`: string, ≥20 chars. **No `Authorization` header needed** — the refresh token is the credential. Returns a **brand-new** `AuthResponse`; the presented refresh token is immediately revoked.

> ⚠️ **Replace the stored refresh token with the new one on every refresh.** The old one is single-use and now dead. Re-sending it will fail (see reuse handling below).

### `POST /v1/auth/logout` → `204`

```jsonc
{ "refreshToken": "QxV3c...base64url..." }
```

Revokes that refresh token (idempotent — revoking an unknown/already-revoked token still returns `204`). Empty body. **The access token is stateless and stays valid until it expires (≤15 min)** — drop it client-side; the server does not invalidate it.

### `GET /v1/auth/me` → `200`

Header: `Authorization: Bearer <accessToken>`. Returns the current `UserResponse` (the `user` shape above). `401` if the token is missing/expired/invalid or the account is inactive. Use this to re-hydrate the user on app start after a refresh.

### Social sign-in — `POST /v1/auth/{google,apple,github}` → `200`

Send the provider credential (`{ "idToken": "..." }` for Google/Apple, `{ "code": "..." }` for GitHub). On success returns the same `AuthResponse`. First-time social login auto-creates the account, or links the provider to an existing account with the same email.

---

## Error handling

Standard Nest shape: `{ "statusCode": 401, "message": "invalid credentials", "error": "Unauthorized" }`.

| Status | When | Frontend action |
|---|---|---|
| **400** | Validation (bad email, short password, bad username, refresh token too short) | Show field errors. |
| **401** | Wrong credentials / disabled account (`login`); expired or invalid access token (any protected call); invalid/expired/reused refresh token (`refresh`) | For protected calls: try `/refresh` once. For `login`/`refresh`: clear session, go to login. |
| **409** | Email or username already registered (`register`) | Tell the user to log in or pick another username. |
| **429** | Login rate limit (5 / 15 min per IP) | Back off; show "too many attempts, try again later." |

---

## Security mechanics (FYI)

Not needed to integrate, but explains the behaviour:

- **Refresh tokens are stored hashed.** The server keeps only a SHA-256 hash of each refresh token, with `expiresAt`, `revokedAt`, and the issuing `userAgent`/`ipAddress`. The raw value exists only in the response — if lost, it can't be recovered, only rotated.
- **Rotation + reuse detection.** `/refresh` looks up the presented token among non-revoked, non-expired records, revokes it, and issues a new pair. If a token is **not** currently valid but *was* previously issued (i.e. a revoked token is being replayed), the server treats it as a possible theft and **revokes every active refresh token for that user** — forcing a fresh login everywhere. Practical effect: if your client accidentally reuses an old refresh token, the whole session chain is invalidated and the user must log in again.
- **Access tokens are stateless.** They carry `{ sub: userId, email }`, are verified by signature + expiry on each request, and are resolved to the live user (inactive users are rejected). Because they aren't stored, logout/refresh can't revoke an already-issued access token — it simply expires within ≤15 min.

Implementation: [auth.service.ts](../../src/auth/auth.service.ts), [token.service.ts](../../src/auth/services/token.service.ts), [jwt.strategy.ts](../../src/auth/strategies/jwt.strategy.ts).
