# Admin — list vocabularies

`GET /v1/admin/vocabularies` — **Auth:** `Authorization: Bearer <accessToken>`, signed-in user must have role `admin` (`403` otherwise).

Lists the **entire** `vocabularies` table (system + user-created) with admin-only fields inlined. Backs the admin "manage vocabulary" screen.

Source: [src/vocabularies/admin-vocabularies.controller.ts](../../src/vocabularies/admin-vocabularies.controller.ts)

## Request

No body. All filtering/paging is via query params (all optional).

| Name | Type | Default | Notes |
| --- | --- | --- | --- |
| `language` | string (ISO 639) | — | e.g. `en`, `pt-BR` |
| `cefrLevel` | `A1`–`C2` | — | |
| `topic` | slug | — | inner-joins on `vocabulary_topics` |
| `q` | string | — | `lemma ILIKE '<q>%'` (prefix) |
| `source` | `system` \| `user` | — | |
| `isApproved` | `true` \| `false` | — | empty / missing / other = no filter |
| `visibility` | `system` \| `private` \| `public` | — | |
| `createdByUserId` | uuid | — | scopes to one user's submissions |
| `translationLang` | string (ISO 639) | — | restricts hydrated translations to one language |
| `sortBy` | `createdAt` \| `frequencyRank` | `createdAt` | |
| `sortDir` | `asc` \| `desc` | `asc` | tie-breaks on `lemma ASC` |
| `page` | int ≥ 1 | `1` | |
| `limit` | int 1–100 | `20` | |

## Response fields

Each `data[]` row is a full vocabulary with admin-only fields inlined. Notable fields:

| Field | Type | Notes |
| --- | --- | --- |
| `imageUrl` | string \| null | **Representative thumbnail** for the list/table. The `imageUrl` of the lowest-ordered sense that has one, or `null` if no sense has an image. Convenience only — the full per-sense images stay under `senses[].imageUrl`. |
| `images` | string[] | **All distinct sense images** for this vocabulary, in `senseOrder`, with nulls dropped and duplicate URLs collapsed. Empty array `[]` when no sense has an image. `imageUrl` equals `images[0] ?? null`. |
| `visibility` | `system` \| `private` \| `public` | admin-only |
| `isApproved` | boolean | admin-only |
| `createdByUserId` | uuid \| null | admin-only; `null` for system rows |
| `createdAt` / `updatedAt` | ISO timestamp | admin-only |
| `senses[]` | array | full sense tree, ordered by `senseOrder`; each carries `imageUrl`, `translations[]`, `examples[]` |
| `topics[]` | array | linked topics, sorted by slug |

## Example request

```http
GET /v1/admin/vocabularies?source=system&q=app&page=1&limit=20 HTTP/1.1
Authorization: Bearer <admin-accessToken>
```

## Example response — `200 OK`

```json
{
  "data": [
    {
      "id": "8e1a0e9b-2c4b-4f6d-9a0e-1a3d5c7e9b11",
      "language": "en",
      "lemma": "apple",
      "partOfSpeech": "noun",
      "ipa": "ˈæp.əl",
      "cefrLevel": "A1",
      "frequencyRank": 1024,
      "audioUrl": null,
      "source": "system",
      "imageUrl": "https://cdn.example.com/vocab/apple.png",
      "images": ["https://cdn.example.com/vocab/apple.png"],
      "visibility": "system",
      "isApproved": true,
      "createdByUserId": null,
      "createdAt": "2026-05-01T08:12:33.000Z",
      "updatedAt": "2026-05-02T09:00:00.000Z",
      "senses": [
        {
          "id": "…",
          "senseOrder": 1,
          "gloss": "fruit",
          "definition": null,
          "imageUrl": "https://cdn.example.com/vocab/apple.png",
          "translations": [
            { "id": "…", "language": "vi", "translation": "quả táo", "note": null }
          ],
          "examples": [
            { "id": "…", "sentence": "I ate an apple.", "translation": null, "source": "manual" }
          ]
        }
      ],
      "topics": [
        { "id": "tp-002", "slug": "food", "name": "Food", "description": null, "iconUrl": null }
      ]
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

## Errors

| Status | When |
| --- | --- |
| `400` | Invalid query param (e.g. `limit` out of `1–100`, malformed `createdByUserId` uuid) |
| `401` | Missing/expired access token → refresh or re-login |
| `403` | Authenticated but not an admin |

## Frontend notes

- **Thumbnail:** render `imageUrl` directly in the table cell; show a placeholder when it is `null`. No need to dig into `senses[]` for the list view.
- **All images:** use `images` (distinct, ordered) to render a gallery/stack of every sense thumbnail in a row; it is `[]` when there are none.
- **Pagination:** `total` is the unfiltered-by-page count for the current filter set — use it with `page`/`limit` to drive the pager.
- Filters compose with `AND`; `q` is a case-insensitive **prefix** match on `lemma`.
