# Admin — Draft a speaking-room scenario with AI (frontend guide)

An optional **"Draft with AI"** helper on the admin scenario-authoring screen. The admin types a short brief (e.g. *"café ordering, B1"*) and the backend asks an LLM (Groq `llama-3.1-8b-instant`) to propose a complete scenario spec. The result is **not saved** — it is a draft you use to **prefill the create form**, which the admin can edit before calling `POST /v1/admin/scenarios`.

- **Endpoint:** `POST /v1/admin/scenarios/draft`
- **Auth:** `Authorization: Bearer <accessToken>` — role `admin` (else `403`)
- **Content type:** `application/json`
- Canonical contract: [api-endpoints.md](../backend/api-endpoints.md) · authoring flow: [admin_create_scenario.md](admin_create_scenario.md) · design rationale: [speaking_room_phase1_admin_authoring.md](../plans/speaking_room_phase1_admin_authoring.md)

---

## Request

```jsonc
{
  "brief": "café ordering, B1",   // required — a short free-text brief
  "cefrLevel": "B1",              // optional — pin the level; omit to let AI infer
  "topic": "food"                 // optional — pin the topic slug; omit to let AI infer
}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `brief` | ✅ | string | 3–500 chars |
| `cefrLevel` | — | enum | `A1`,`A2`,`B1`,`B2`,`C1`,`C2`. When set, the draft is forced to this level |
| `topic` | — | string | 1–64 chars, lowercase slug `^[a-z0-9-]+$`. When set, the draft is forced to this topic |

Validation is strict — unknown body fields are rejected with `400`.

---

## Response (200)

The drafted spec. Every field except `model` maps **1:1 onto the create form** ([admin_create_scenario.md](admin_create_scenario.md)); prefill the form with these values and let the admin edit, then submit `POST /v1/admin/scenarios`.

```jsonc
{
  "title": "Ordering at a café",
  "topic": "food",                          // slug, already normalised
  "cefrLevel": "B1",                        // or null = any level
  "setting": "A busy café at lunchtime. The barista is friendly but busy.",
  "aiRole": "barista",
  "userRole": "customer",
  "goal": "Order a drink and a snack, and ask for the price.",
  "openingLine": "Hi there! What can I get for you today?",
  "seedPhrases": ["I'd like...", "How much is...", "for here or to go"],
  "estTurns": 8,                            // or null
  "introVideoScript": "You walk into a busy café...", // or null
  "model": "llama-3.1-8b-instant"           // which LLM produced this draft
}
```

> The draft is a **suggestion, not a saved record** — nothing exists in the database until the admin submits the create form. The returned `topic`/`cefrLevel` already satisfy the create-form rules, but the admin can change anything.

---

## Errors

| Status | When | Frontend handling |
|---|---|---|
| `400` | validation failure (brief too short, bad slug, unknown field) | show inline field errors |
| `401` | missing/expired token | send to login / refresh |
| `403` | logged in but not an admin | hide the screen |
| `503` | the helper is **not configured** (no API key) **or** the model failed/timed out | show "AI drafting is unavailable — fill the form manually" and keep the manual form usable |

## UX notes

- The call is **synchronous** and can take a few seconds (one LLM round-trip). Show a loading state on the "Draft with AI" button and disable it while in flight.
- Treat the helper as **optional convenience**: the manual create form must always work even if drafting returns `503`.
- Always let the admin **review and edit** the prefilled values before creating — the LLM output is a starting point, not a finished scenario.
