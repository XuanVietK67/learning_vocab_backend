# Admin — get one vocabulary (incl. drafts)

`GET /v1/admin/vocabularies/:id` — **Auth:** `Authorization: Bearer <accessToken>`, signed-in user must have role `admin` (`403` otherwise).

Reads a single **system** vocabulary by id, **including unapproved quick-create drafts** (`isApproved: false`). This is the endpoint to call when opening the pre-approval review/edit screen — the public `GET /v1/vocabularies/:id` 404s on drafts, so it cannot be used to load a freshly quick-created word for editing.

Returns the same admin shape as a row of [admin_list_vocabularies.md](admin_list_vocabularies.md), so the edit form gets the full sense tree plus the admin-only `isApproved` / `visibility` state.

Source: [src/vocabularies/admin-vocabularies.controller.ts](../../src/vocabularies/admin-vocabularies.controller.ts)

## Request

No body.

| Param | In | Type | Required | Notes |
| --- | --- | --- | --- | --- |
| `id` | path | uuid v4 | yes | the vocabulary id (e.g. from a `GET /v1/admin/vocabularies` row, or `resultVocabularyIds[]` of a quick-create job) |
| `translationLang` | query | string (ISO 639) | no | restricts hydrated `senses[].translations[]` to one language |

## Response fields — `200 OK`

A single vocabulary object with admin-only fields inlined. Notable fields:

| Field | Type | Notes |
| --- | --- | --- |
| `imageUrl` | string \| null | Representative thumbnail — `imageUrl` of the lowest-ordered sense that has one, or `null`. Equals `images[0] ?? null`. |
| `images` | string[] | All distinct sense images, in `senseOrder`, nulls dropped and duplicates collapsed. `[]` when none. |
| `visibility` | `system` \| `private` \| `public` | admin-only |
| `isApproved` | boolean | admin-only — `false` for a quick-create draft, `true` after approval |
| `createdByUserId` | uuid \| null | admin-only; `null` for system rows |
| `createdAt` / `updatedAt` | ISO timestamp | admin-only |
| `senses[]` | array | full sense tree, ordered by `senseOrder`; each carries `imageUrl`, `synonyms[]`, `antonyms[]`, `translations[]`, `examples[]` |
| `topics[]` | array | linked topics, sorted by slug |

## Example request

```http
GET /v1/admin/vocabularies/8e1a0e9b-2c4b-4f6d-9a0e-1a3d5c7e9b11?translationLang=vi HTTP/1.1
Authorization: Bearer <admin-accessToken>
```

## Example response — `200 OK`

A quick-create draft (`isApproved: false`) ready to edit:

```json
{
  "id": "8e1a0e9b-2c4b-4f6d-9a0e-1a3d5c7e9b11",
  "language": "en",
  "lemma": "study",
  "partOfSpeech": "verb",
  "ipa": "ˈstʌd.i",
  "cefrLevel": "A2",
  "frequencyRank": 412,
  "audioUrl": null,
  "source": "system",
  "enrichmentStatus": "enriched",
  "imageUrl": null,
  "images": [],
  "visibility": "system",
  "isApproved": false,
  "createdByUserId": null,
  "createdAt": "2026-06-07T08:12:33.000Z",
  "updatedAt": "2026-06-07T08:12:40.000Z",
  "senses": [
    {
      "id": "s-001",
      "senseOrder": 1,
      "gloss": "to learn for school/exam",
      "definition": "spend time learning a subject, especially for a test",
      "imageUrl": null,
      "synonyms": ["learn", "revise"],
      "antonyms": [],
      "translations": [
        { "id": "t-001", "language": "vi", "translation": "học, học tập", "note": null, "source": "gemma" }
      ],
      "examples": [
        { "id": "e-001", "sentence": "She studies biology at university.", "translation": null, "source": "gemma" }
      ]
    }
  ],
  "topics": []
}
```

## Errors

| Status | When |
| --- | --- |
| `400` | `id` is not a valid uuid v4, or `translationLang` malformed |
| `401` | Missing/expired access token → refresh or re-login |
| `403` | Authenticated but not an admin |
| `404` | No **system** vocabulary with that id (user-created words and unknown ids both 404 here) |

## Frontend notes

- **This is the read for the edit screen.** Load the draft here, render the form, then save through the existing mutation endpoints — none of which gate on approval status:
  - top-level fields → `PATCH /v1/admin/vocabularies/:id`
  - senses → `POST` / `PATCH` / `DELETE` / `PUT reorder` under `/v1/admin/vocabularies/:id/senses`
  - translations & examples → the nested routes under a sense
  - topics → `PUT /v1/admin/vocabularies/:id/topics`
- **Re-fetch after nested edits.** Sense/translation/example mutations return only the changed entity; re-call this endpoint to get the reconciled vocabulary (e.g. recomputed `imageUrl`/`images`, contiguous `senseOrder` after a delete).
- **Approve when done:** `POST /v1/admin/vocabularies/:id/approve` flips `isApproved` and enqueues audio/image generation.
- Only `source = 'system'` rows are visible here; this is not a read path for user-created words (`source = 'user'`).
