# User profile — read & update

`GET /v1/users/:id` and `PATCH /v1/users/:id` — **JWT required, self only.** A caller may only read/update their own record; acting on another user's id returns `403`.

These manage the caller's profile: the onboarding fields (language pair, level, goals) and the `leaderboardOptOut` privacy toggle.

---

## `GET /v1/users/:id`

Returns the full user object.

**Response `200`**

```json
{
  "id": "9f1a2b3c-4d5e-6f70-8a91-b2c3d4e5f607",
  "email": "alice@example.com",
  "username": "alice_99",
  "avatarUrl": null,
  "role": "user",
  "isEmailVerified": false,
  "isActive": true,
  "isOnboarded": true,
  "nativeLanguage": "vi",
  "targetLanguage": "en",
  "proficiencyLevel": "B1",
  "dailyGoalMinutes": 20,
  "weeklyVocabGoal": 50,
  "leaderboardOptOut": false,
  "createdAt": "2026-05-26T08:30:00.000Z",
  "updatedAt": "2026-06-10T09:00:00.000Z"
}
```

`role` is `"user"` or `"admin"`. This is the same shape returned by `GET /v1/auth/me`. **`403`** if `:id` is not the caller. **`404`** if the user does not exist.

## `PATCH /v1/users/:id`

Partial update — send any subset of the fields below. Sending **all five** onboarding fields (`nativeLanguage`, `targetLanguage`, `proficiencyLevel`, `dailyGoalMinutes`, `weeklyVocabGoal`) for the first time flips `isOnboarded` to `true`. `leaderboardOptOut` is independent of onboarding and can be toggled at any time.

**Request body** (all optional)

```json
{
  "nativeLanguage": "vi",
  "targetLanguage": "en",
  "proficiencyLevel": "B1",
  "dailyGoalMinutes": 20,
  "weeklyVocabGoal": 50,
  "leaderboardOptOut": true
}
```

| Field | Required? | Type | Rules |
|---|---|---|---|
| `nativeLanguage` | no | string | ISO 639-1, optional region — `^[a-z]{2}(-[A-Z]{2})?$`, length 2–8 (e.g. `en`, `vi`, `pt-BR`). |
| `targetLanguage` | no | string | Same rule as `nativeLanguage`. Must differ from `nativeLanguage` (else `400`). |
| `proficiencyLevel` | no | enum | One of `A1`, `A2`, `B1`, `B2`, `C1`, `C2`. |
| `dailyGoalMinutes` | no | int | 5–240. |
| `weeklyVocabGoal` | no | int | 5–250 (target new vocabularies per week). |
| `leaderboardOptOut` | no | boolean | `true` hides the user from every [leaderboard](community_leaderboard.md)'s `data` and rank denominator; they still see their own `me` (as `{ rank: null, value: 0 }`). Defaults to `false`. |

**Response `200`**: the updated user object (same shape as `GET` above).

## Errors

| Status | When |
|---|---|
| `400` | A field fails its rule, `targetLanguage === nativeLanguage`, or onboarding is attempted without all five onboarding fields present. |
| `401` | Missing / invalid JWT. |
| `403` | `:id` is not the caller. |
| `404` | User not found. |

## Client notes

- The privacy switch ("Appear on leaderboard") maps to `leaderboardOptOut` inverted: switch **on** → `leaderboardOptOut: false`. Read the current value from this endpoint (or `GET /v1/auth/me`).
- Because `transform + whitelist` is on, unknown body fields are rejected with `400` — send only the fields above.
