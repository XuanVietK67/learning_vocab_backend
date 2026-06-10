# Frontend design guide — user vocabulary lists (3 phases)

Layout & UX guide for the "users build vocabulary lists like admin" feature set.
This is the **screen / flow** view; for exact request & response shapes see the
per-feature docs linked in each phase and the contract in
[api-endpoints.md](../backend/api-endpoints.md).

The work ships in three phases. Each maps to a cluster of user-facing surfaces:

| Phase | What the user can do | New screens |
|---|---|---|
| **A — Public / shareable decks** | Make a deck public, browse a community catalog, clone a deck | Community browse, Public deck preview, Visibility control on deck create/edit, Clone action |
| **B — Richer user words** | Create a word from just the lemma; a worker enriches it | Quick-add word + job progress, My Words list |
| **C — Bulk add to lists** | Paste a list of words into a deck; each is enriched & auto-added | Bulk import sheet + batch progress |

A "vocabulary list" in the UI = a **Deck**. A "word" = a **Vocabulary**.

---

## 0. Shared building blocks

Design these once; all three phases reuse them.

### Deck card

Used in My Decks, Community browse, and suggested decks.

```
┌────────────────────────────────────────────┐
│ ●●●  IELTS Band 7 essentials      [PUBLIC]  │  ← visibility badge
│      48 words · English · B2                │
│      "Words I drilled for writing task 2"   │  ← description (truncate 2 lines)
│                                  [⋯ menu]   │
└────────────────────────────────────────────┘
```

- **Visibility badge** drives the card's identity. Three states:
  - `system` → "Catalog" / no badge (seeded deck, `ownerId: null`)
  - `private` → "Private" (lock icon)
  - `public` → "Public" (globe icon)
- Show `vocabCount`, `language`, `cefrLevel` (may be null → hide the chip).
- The `⋯` menu items depend on ownership (mine vs. someone else's — see below).

Every deck payload now carries `visibility` and `ownerId`, so the client can
decide ownership with `ownerId === currentUserId` and badge with `visibility`.

### Async job/batch pattern (Phases B & C)

Enrichment is **asynchronous** — the API returns `202` immediately and the UI
polls. Build one reusable "enrichment progress" pattern:

```
submit → 202 { id | batchId } → poll every 1–2s (backoff) → done
            │                         │
            └─ optimistic "Adding…"   └─ pending===0  (batch)
                                         status==='completed'|'failed' (single job)
```

- **Single word** (Phase B): poll `GET /v1/me/vocabularies/jobs/:jobId` until
  `status` is `completed` / `failed`.
- **Batch** (Phase C): poll `GET /v1/me/vocabularies/batches/:batchId` until
  `pending === 0`; render a progress bar from `completed / total`.
- Always offer a non-blocking path: the user can leave the screen; results land
  in My Words / the deck regardless. A toast or badge can announce completion.
- **Audio lags** even after a job completes (separate queue) — don't block UI on
  `audioUrl`; show a speaker icon that becomes active when it arrives.

---

## Phase A — Public / shareable decks

Per-feature API doc: [decks_share_and_clone.md](decks_share_and_clone.md).

### A1. My Decks (existing list, +visibility)

The deck list gains the **visibility badge** and a publish toggle entry point.

```
My Decks                                   [+ New deck]
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Deck card    │ │ Deck card    │ │ Deck card    │
│   [PRIVATE]  │ │   [PUBLIC]   │ │   [PRIVATE]  │
└──────────────┘ └──────────────┘ └──────────────┘
```

`⋯` menu for **my** deck: Edit · **Publish / Make private** · Bulk-import · Delete.

### A2. Create / edit deck — visibility control

Add a single control to the existing deck form:

```
Visibility
( ) Private — only you can see it
(•) Public  — anyone can find & clone it
```

- Maps to `visibility` on `POST` / `PATCH /v1/me/decks`. Only `private`/`public`
  are valid (no `system`). Default `private`.
- When switching **private → public**, show a one-line confirm: *"Publishing
  shares this deck and its words with everyone."* (Publishing exposes the
  author's own user-words too.)

### A3. Community browse

New top-level discovery screen, fed by `GET /v1/decks/public` (no auth required,
but typically shown to signed-in users so Clone is one tap).

```
Community decks            [search]  [lang ▾] [CEFR ▾]
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Deck card    │ │ Deck card    │ │ Deck card    │   ← grid of public decks
│  by @author  │ │  by @author  │ │  by @author  │
└──────────────┘ └──────────────┘ └──────────────┘
            ← paginated (page/limit, newest first) →
```

- Filters: `language`, `cefrLevel`. Standard pagination footer.
- Each card → A4 preview. A primary **Clone** affordance can sit on the card.

### A4. Public deck preview (read-only)

Opening a community deck uses `GET /v1/decks/:id` (works for `public` + `system`;
a `private` deck 404s here — render a generic "not available").

```
← Back
IELTS Band 7 essentials              [Clone to my decks]
by @author · 48 words · English · B2

  1. resilient   /rɪˈzɪliənt/   adj   "able to recover…"
  2. tenacious   /təˈneɪʃəs/    adj   "holding firmly…"
  …                                   (ordered, read-only)
```

- Read-only word list (ordered). No edit/membership controls — it's not theirs.
- The only write action is **Clone**.

### A5. Clone action

`POST /v1/me/decks/:id/clone` → `201` with the **new** private deck.

- Optimistic: show "Cloned ✓ — open" toast/CTA that deep-links to the new deck in
  My Decks (it returns full deck detail, so you can navigate immediately).
- The copy is `private`, owned by the user, fully editable. Independent of the
  original (except member words are shared rows — note for the user only if
  relevant).

**Empty / error states**

| Screen | Empty | Error |
|---|---|---|
| Community browse | "No public decks yet" illustration | toast + retry |
| Public preview | — | `404` → "This deck isn't available" |
| Clone | — | `401` → prompt sign-in; generic → toast |

---

## Phase B — Richer user words (quick-create)

Per-feature API doc: [me_vocabulary_quick_create.md](me_vocabulary_quick_create.md).

### B1. Quick-add word

A lightweight "add a word" entry (FAB, or a field at the top of My Words).

```
Add a word
┌───────────────────────────────┐
│ resilient                     │  ← lemma (1–128)
└───────────────────────────────┘
  Language [en ▾]   Translate to [vi ▾]   (advanced/optional)
                                   [ Add → ]
```

On submit → `POST /v1/me/vocabularies/quick-create` → `202 { id, status:'pending' }`.

### B2. Enrichment progress (inline)

Swap the row for a progress state while the worker enriches:

```
┌───────────────────────────────┐
│ ⏳ resilient — enriching…      │   poll jobs/:jobId
└───────────────────────────────┘
        │ completed
        ▼
┌───────────────────────────────┐
│ ✓ resilient  adj · /rɪˈzɪliənt/│   → tap to open full word
└───────────────────────────────┘
```

- `completed` → `resultVocabularyIds` (1+; a word can be noun **and** verb).
  Fetch each with `GET /v1/me/vocabularies/:id` to show senses/translations.
- `completed` with empty `resultVocabularyIds` → "You already have this word."
- `failed` → "Couldn't build that word" + Retry (re-submit same lemma).
- Non-blocking: user can keep adding; completed words stream into My Words.

### B3. My Words list

Reuse the existing `GET /v1/me/vocabularies` list. Quick-created words appear here
(auto-approved, `private`). Distinguish nothing special vs. manually created — they
look the same to the user; both are "my words."

| State | Treatment |
|---|---|
| Loading | skeleton rows |
| Empty | "Add your first word" → opens B1 |
| Error | toast + retry |

---

## Phase C — Bulk add to a list

Per-feature API doc: [decks_bulk_import.md](decks_bulk_import.md).

### C1. Bulk import sheet (entry: deck `⋯` → "Bulk import")

Opened from a deck the user owns.

```
Bulk import into "IELTS Band 7 essentials"
┌───────────────────────────────────────────┐
│ resilient                                 │
│ tenacious                                 │  ← textarea / paste
│ perseverance                              │     one lemma per line
│ …                                         │     (1–500)
└───────────────────────────────────────────┘
  Language [en ▾]   Translate to [vi ▾]
                                  [ Import 3 words → ]
```

- Parse the textarea into `lemmas[]` (split on newlines/commas; trim; drop blanks;
  cap 500). Show the count on the button.
- Submit → `POST /v1/me/decks/:id/bulk-import` → `202 { batchId, accepted, skipped }`.
- If `accepted === 0` (all skipped) → inline note "All of these are already in your
  words" and **no** batch to poll (`batchId` is `null`).

### C2. Batch progress

After `202`, show a progress view (modal or inline banner on the deck):

```
Importing 3 words…                       [run in background]
████████████░░░░░░░░  2 / 3            (completed / total)
✓ 2 added   ⏳ 1 enriching   ✕ 0 failed
```

- Poll `GET /v1/me/vocabularies/batches/:batchId` until `pending === 0`.
- Drive the bar from `completed / total`; show `failed` count if any.
- Words land in the deck **as they finish** — refresh the deck list incrementally
  (on each poll where `completed` rises) or once at `pending === 0`.
- "Run in background" dismisses the modal; a toast/badge announces completion.

**States**

| State | Treatment |
|---|---|
| Accepted, polling | progress bar + counts |
| Some skipped | "(2 already in your words — skipped)" subtext |
| All skipped (`batchId: null`) | inline note, no progress view |
| Partial fail at end | "2 added, 1 couldn't be built" + Retry-failed (re-submit the missing lemmas) |
| Error on submit | `403` not-your-deck → shouldn't happen from owned UI; generic → toast |

---

## Navigation map

```
Home / Library
├── My Decks ─────────── Deck detail ──┬── Edit (visibility A2)
│     (A1)                  │           ├── Bulk import (C1 → C2)
│                          │           └── Add/remove words (existing)
├── Community  (A3) ── Public preview (A4) ── Clone (A5) → My Decks
│
└── My Words  (B3) ── Quick-add (B1 → B2) ── Word detail
```

## Cross-cutting UX notes

- **Optimism + async truth.** Every enrichment action is fire-and-forget on the
  server. Show optimistic UI immediately, reconcile from the poll. Never block the
  whole screen on a job.
- **Ownership decides controls.** `ownerId === me` → full controls; otherwise
  read-only + Clone. `visibility` only changes the badge, not permissions.
- **Counts can shift.** `vocabCount` and deck membership update asynchronously
  during bulk import; treat them as live, re-fetch rather than cache hard.
- **Audio is always late.** Render words without audio first; light up the speaker
  when `audioUrl` is present on a later fetch.
- **Validation echoes the contract.** Lemma 1–128 chars; up to 500 per bulk import;
  language codes `^[a-z]{2}(-[A-Z]{2})?$`; CEFR `A1–C2`. Validate client-side to
  avoid round-trip `400`s.
