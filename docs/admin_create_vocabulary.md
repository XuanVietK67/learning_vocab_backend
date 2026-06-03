# Admin — Create a new vocabulary (frontend guide)

How the **admin "create vocabulary" screen** talks to the backend: the one API call it makes, exactly what to send, what comes back, what the client should validate before sending, and how to handle errors and the async audio.

- **Endpoint:** `POST /v1/admin/vocabularies`
- **Auth:** `Authorization: Bearer <accessToken>` — the signed-in user must have role `admin`
- **Content type:** `application/json`
- Canonical contract: [api-endpoints.md](api-endpoints.md) · general conventions: [frontend_handoff.md](frontend_handoff.md)

> This is the **admin / system** path: the word is created as `source: "system"`, publicly visible, and approved immediately. A separate end-user path (`POST /v1/me/vocabularies`) creates private user-owned words — don't confuse the two on the frontend.

---

## Workflow from the UI

```
[Admin fills the create-vocabulary form]
        │
        │  validate client-side (see "Field rules")
        ▼
POST /v1/admin/vocabularies   (Bearer admin token + JSON body)
        │
        ├─ 401 → token missing/expired → send to login / refresh
        ├─ 403 → logged in but not admin → hide/disable the screen
        ├─ 400 → validation or unknown topic slug → show field errors
        ├─ 409 → this word already exists → tell the admin it's a duplicate
        │
        └─ 201 → success → returns the full vocabulary object
                 │
                 └─ audioUrl is null for now (generated in background).
                    Re-fetch the word later (GET) to get the audio URL.
```

The whole feature is **a single request**. There is no multi-step wizard on the API side — senses, translations, examples, and topic links are all sent in one body and saved together (atomically: if any part is invalid, nothing is saved).

---

## Request

### Headers

```http
POST /v1/admin/vocabularies HTTP/1.1
Authorization: Bearer <admin-accessToken>
Content-Type: application/json
```

### Body shape

```jsonc
{
  "language": "en",                 // required
  "lemma": "ephemeral",             // required — the word itself
  "partOfSpeech": "adjective",      // required — enum (see below)
  "ipa": "/əˈfem(ə)rəl/",           // optional
  "cefrLevel": "C1",                // optional — A1..C2
  "frequencyRank": 18452,           // optional — integer >= 0
  "audioUrl": null,                 // optional — omit to auto-generate audio
  "topics": ["time", "literature"], // optional — existing topic slugs

  "senses": [                       // required — 1..16 senses
    {
      "gloss": "short-lived",       // optional — short label
      "definition": "Lasting for a very short time.", // optional
      "imageUrl": null,             // optional
      "synonyms": ["transient", "fleeting"],          // optional
      "antonyms": ["permanent"],    // optional
      "translations": [             // optional — 0..16
        { "language": "vi", "translation": "phù du", "note": null, "source": "manual" }
      ],
      "examples": [                 // required — MINIMUM 2 per sense
        { "sentence": "Fame can be ephemeral.", "translation": "Danh tiếng có thể chỉ là phù du." },
        { "sentence": "Their happiness proved ephemeral." }
      ]
    }
  ]
}
```

### Field rules (validate these client-side before sending)

The backend rejects anything that breaks these with `400`. Enforcing them in the form gives faster feedback.

| Field | Required | Rule |
|---|---|---|
| `language` | ✅ | ISO 639-1 code, regex `^[a-z]{2}(-[A-Z]{2})?$` (e.g. `en`, `vi`, `pt-BR`), 2–8 chars |
| `lemma` | ✅ | 1–128 chars |
| `partOfSpeech` | ✅ | one of: `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `interjection`, `phrase`, `other` |
| `ipa` | — | 1–128 chars |
| `cefrLevel` | — | one of `A1`, `A2`, `B1`, `B2`, `C1`, `C2` |
| `frequencyRank` | — | integer ≥ 0 |
| `audioUrl` | — | 1–512 chars. **Omit it to have audio auto-generated.** |
| `topics` | — | up to 32 slugs, each `^[a-z0-9-]+$`; **each must be an existing topic** (unknown slug → `400`) |
| `senses` | ✅ | **1–16** items |
| `senses[].gloss` | — | 1–128 chars |
| `senses[].definition` | — | 1–2000 chars |
| `senses[].imageUrl` | — | 1–512 chars |
| `senses[].synonyms` / `antonyms` | — | up to 32 items, each 1–64 chars |
| `senses[].translations` | — | up to 16; each needs `language` (lang code) + `translation` (1–255 chars); `note` (≤2000) and `source` (≤32) optional |
| `senses[].examples` | ✅ | **2–16** items; each needs `sentence` (1–1000 chars); `translation` (≤1000) and `source` (≤32) optional |

> ⚠️ **The two most common form mistakes:** (1) sending only **one** example per sense — the minimum is **2** (the extra example is held out as a hidden test sentence by the learning module); (2) sending a **topic slug that doesn't exist** — create the topic first, or only offer existing slugs in the picker.
>
> Also: the global validation strips/rejects **unknown fields**, so don't send extra keys the form doesn't need.

---

## Response

### `201 Created`

Returns the complete, hydrated vocabulary object (this is the same shape returned by `GET /v1/vocabularies/:id`):

```json
{
  "id": "8f1d2c34-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
  "language": "en",
  "lemma": "ephemeral",
  "partOfSpeech": "adjective",
  "ipa": "/əˈfem(ə)rəl/",
  "cefrLevel": "C1",
  "frequencyRank": 18452,
  "audioUrl": null,
  "source": "system",
  "enrichmentStatus": null,
  "senses": [
    {
      "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      "senseOrder": 1,
      "gloss": "short-lived",
      "definition": "Lasting for a very short time.",
      "imageUrl": null,
      "synonyms": ["transient", "fleeting"],
      "antonyms": ["permanent"],
      "translations": [
        { "id": "…", "language": "vi", "translation": "phù du", "note": null, "source": "manual" }
      ],
      "examples": [
        { "id": "…", "sentence": "Fame can be ephemeral.", "translation": "Danh tiếng có thể chỉ là phù du.", "source": "manual" },
        { "id": "…", "sentence": "Their happiness proved ephemeral.", "translation": null, "source": "manual" }
      ]
    }
  ],
  "topics": [
    { "slug": "literature", "name": "Literature", "description": null, "iconUrl": null },
    { "slug": "time", "name": "Time", "description": null, "iconUrl": null }
  ]
}
```

Notes for the UI:

- **`id`** — newly generated UUID; use it to navigate to the word's detail/edit page.
- **`audioUrl` is `null` right away.** Audio is generated by a background worker. To show audio, **re-fetch the word** (e.g. `GET /v1/vocabularies/:id`) a little later, or refresh on the detail page — don't expect it in this response.
- **`senseOrder`** is assigned by the server (1-based), in the order you sent the senses.
- **`topics`** comes back sorted by slug, each as a full topic object (not just the slug).
- Translation/example `source` defaults to `"manual"` when you don't send one.

---

## Error handling

Standard Nest error shape:

```json
{ "statusCode": 400, "message": ["senses.0.examples must contain at least 2 elements"], "error": "Bad Request" }
```

| Status | Meaning | What the frontend should do |
|---|---|---|
| **401** | No / expired / invalid token | Trigger token refresh or send the user to login. |
| **403** | Logged in but not an admin | This screen shouldn't be reachable — hide/disable it for non-admins. |
| **400** | A field broke validation, an unknown body field was sent, or a `topics` slug doesn't exist (`"unknown topic slug: …"`) | Map `message` to the offending field(s) and show inline errors. |
| **409** | A system word with the same `(language, lemma, partOfSpeech)` already exists | Tell the admin it's a duplicate; offer to open the existing word instead. `message` explains it. |

`message` is sometimes a string and sometimes an array of strings — handle both.

---

## What the backend does with the request (FYI)

Not needed to call the API, but useful context:

1. Guards check the JWT (`401`) and the `admin` role (`403`).
2. The body is validated against the rules above (`400`).
3. It checks for an existing system word with the same `(language, lemma, partOfSpeech)` → `409` if found.
4. In a single DB transaction it writes the vocabulary, its senses, each sense's translations and examples, and the topic links. If any step fails, the whole thing rolls back — you never get a half-created word.
5. After commit, if you didn't supply `audioUrl`, it queues a background audio-generation job (keyed by the word id, so it won't duplicate). A queue outage never fails the request.
6. It returns the freshly re-read, fully-populated word.

For the full internal trace, see the service [vocabularies.service.ts](../src/vocabularies/vocabularies.service.ts) (`createSystemVocabulary`).
