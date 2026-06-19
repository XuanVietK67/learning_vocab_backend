# Practice — pick words to practise

Two ways to build a practice queue **without searching one word at a time**. Both return the **same item shape**, which you then feed to `POST /v1/me/practice/attempts` (see [practice_submit_sentence.md](practice_submit_sentence.md)) one item at a time.

- `GET /v1/me/practice/suggestions` — "just give me N words." **JWT required.**
- `POST /v1/me/practice/sets` — "I ticked these words, validate them." **JWT required.**

Auth: `Authorization: Bearer <accessToken>` on both. Content type `application/json`.

---

## The shared item shape (`PracticeItem`)

Every word both endpoints return:

```json
{
  "vocabularyId": "c2a1f0e1-1234-4abc-8def-0123456789ab",
  "lemma": "ephemeral",
  "partOfSpeech": "adjective",
  "ipa": "ɪˈfɛm(ə)rəl",
  "audioUrl": "https://cdn.example.com/audio/ephemeral.mp3",
  "glosses": ["lasting for a very short time"]
}
```

| Field | Type | Meaning |
|---|---|---|
| `vocabularyId` | string | UUID — pass this as `vocabularyId` when submitting the attempt. |
| `lemma` | string | The word to practise. |
| `partOfSpeech` | enum | `noun \| verb \| adjective \| adverb \| …`. |
| `ipa` | string \| null | Pronunciation hint; null if unknown. |
| `audioUrl` | string \| null | Reference audio; null if not generated yet. |
| `glosses` | string[] | Up to 5 short meanings (most-salient first). May be empty if the word has no senses yet. |

> Need translations or examples for a word? They aren't in this lean shape — fetch `GET /v1/vocabularies/:id` for the full entry.

---

## `GET /v1/me/practice/suggestions`

"Give me a set of words to practise." Picks from the user's spaced-repetition state (words **due** for review + new words **at their level**), and if that comes up short, tops up with random level-matched words so you always get something.

### Query params

| Param | Required | Type | Rules |
|---|---|---|---|
| `count` | — | int | 1–20, default 10. How many words to return. Capped at 20 to stay under the daily attempt cap (default 30/day). |

### Example

```
GET /v1/me/practice/suggestions?count=8
Authorization: Bearer <accessToken>
```

### Response `200`

```json
{
  "items": [
    { "vocabularyId": "…", "lemma": "ephemeral", "partOfSpeech": "adjective", "ipa": "ɪˈfɛm(ə)rəl", "audioUrl": "…", "glosses": ["lasting for a very short time"] }
  ],
  "usedFallback": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `items` | PracticeItem[] | Up to `count` words, ready to practise. **May be fewer** than `count`, or empty in the extreme case that the catalogue has no words for the user's language. |
| `usedFallback` | bool | `true` when the SRS picker ran short and the list was padded with random level-matched words (which the user may have already studied). Use it if you want to label those as "extra practice." |

> **Read-only.** Unlike starting a learn session, asking for suggestions does **not** enrol any new word into the user's SRS schedule. Practising a word here also doesn't move its review schedule — only the learn/review flow does that.

### Errors

| Status | When | Frontend action |
|---|---|---|
| `400` | `count` out of range, or the user hasn't onboarded (`mode=daily requires onboarding…`) | Send the user through onboarding (set `targetLanguage` + `proficiencyLevel`) first. |
| `401` | Missing/expired JWT | Refresh the access token. |

---

## `POST /v1/me/practice/sets`

"The user ticked these words from a list — give me back the ones they can actually practise." Use this after rendering a checkbox list from [`GET /v1/vocabularies`](../backend/api-endpoints.md) (already paginated/filterable by `language`, `cefrLevel`, `topic`, `q`).

### Request body

```json
{
  "vocabularyIds": [
    "c2a1f0e1-1234-4abc-8def-0123456789ab",
    "d3b2a1f0-5678-4abc-9def-0123456789ab"
  ]
}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `vocabularyIds` | ✅ | string[] | 1–50 items, each a UUID v4. Duplicates are de-duplicated server-side. |

### Response `200`

```json
{
  "items": [
    { "vocabularyId": "c2a1f0e1-1234-4abc-8def-0123456789ab", "lemma": "ephemeral", "partOfSpeech": "adjective", "ipa": "ɪˈfɛm(ə)rəl", "audioUrl": "…", "glosses": ["lasting for a very short time"] }
  ],
  "inaccessibleVocabularyIds": ["d3b2a1f0-5678-4abc-9def-0123456789ab"]
}
```

| Field | Type | Meaning |
|---|---|---|
| `items` | PracticeItem[] | The practiceable words, **in the order they were sent**. |
| `inaccessibleVocabularyIds` | string[] | Requested IDs that don't exist, are another user's private word, or are an unapproved system draft. Flag these as stale in the UI (e.g. uncheck + toast). |

### Errors

| Status | When | Frontend action |
|---|---|---|
| `400` | empty array, >50 items, or a non-UUID id | Fix the selection before submitting. |
| `401` | Missing/expired JWT | Refresh the access token. |

---

## Suggested client flow

1. **Quick start:** call `GET /suggestions?count=10`, take `items`, drop straight into the practice queue.
2. **Hand-pick:** render `GET /v1/vocabularies` as a checkbox list → collect ticked IDs → `POST /sets` → use `items`; surface anything in `inaccessibleVocabularyIds`.
3. For each item: show `lemma` / `glosses` / play `audioUrl`, let the user write or speak a sentence, then `POST /v1/me/practice/attempts` with `{ vocabularyId, text, modality }` and poll for the rubric.
