# Plan: Speaking Room — Phase 1 (Admin Scenario Authoring)

Status: **Draft** · Owner: TBD · Last updated: 2026-06-23

The **Speaking Room** lets a learner practice spoken English in a live, turn-based voice
conversation with an AI partner. This document covers **Phase 1 — the admin authoring
side**: how an admin creates the reusable *scenarios* (and optional intro videos) that
learners later practice. Phase 2 (the live practice session) is in
[speaking_room_phase2_user_practice.md](speaking_room_phase2_user_practice.md).

The guiding split for the whole feature:

| Layer | Cost | Who owns it | When created |
|---|---|---|---|
| **Scenario** (setting, roles, intro **video**) | Expensive — HyperFrames render, fixed MP4 asset | **Admin** | Once, reused by everyone |
| **Target vocabulary** in the conversation | Free — text injected into the live LLM prompt | Per-user | At runtime (Phase 2) |

So **admin owns the fixed assets; the learner's words and level only change the live LLM
prompt at runtime.** Phase 1 is entirely about producing the fixed, reusable assets.

---

## 1. Goal & scope

### In scope (Phase 1)
- An admin-only CRUD surface to create, edit, list, and retire **scenarios**.
- Each scenario is a reusable spec: topic, CEFR level, setting, roles, goal, optional seed
  phrases.
- Optional **intro video** per scenario, pre-rendered once via HyperFrames (HTML → MP4) and
  stored as a URL.
- Scenarios are tagged by **topic + CEFR level** so Phase 2 can recommend ones that match the
  deck a user is studying.

### Out of scope (Phase 1)
- The live conversation loop, STT, LLM replies, TTS — all Phase 2.
- Per-user personalization — scenarios are generic; the user's words/level are applied later.
- Real-time / interactive video. HyperFrames produces **fixed** MP4s only; the intro video
  is a non-interactive cutscene.
- User-generated scenarios. Creation is **admin-only** to control quality and render cost.

### Success criteria
- An admin can publish a complete, validated scenario (with or without a video) end-to-end.
- A published scenario is immutable enough to be safely reused by many concurrent learners
  (edits create a new version rather than mutating an in-flight session — see §5).
- Each intro video is rendered **once** and reused; no per-user or per-session rendering.

---

## 2. Why admin-only

Letting users freely pick *topic + vocabulary* would create an unbounded number of
combinations. The **only** expensive part of that explosion is the **HyperFrames video
render** (and, to a lesser degree, drafting/curating a quality spec). By making **scenarios +
videos** admin-authored:

- videos are rendered once and reused → no resource waste;
- content is curated and reviewable (quality + safety);
- the catalog stays a bounded, browsable set.

Personalization is **not** lost: it moves to the runtime prompt (Phase 2), where injecting a
user's deck words costs nothing.

---

## 3. What a scenario depends on (admin inputs)

The admin provides:

| Field | Required | Meaning / example |
|---|---|---|
| `title` | ✅ | "Ordering at a café" |
| `topic` | ✅ | tag for recommendation, e.g. `food`, `travel`, `work` |
| `cefr_level` | ✅ | target level: `A1`…`C2`, or `any` |
| `setting` | ✅ | scene description: "a busy café at lunchtime" |
| `ai_role` | ✅ | the AI's character: "barista" |
| `user_role` | ✅ | the learner's character: "customer" |
| `goal` | ✅ | what the learner should accomplish: "order a drink + a snack, ask the price" |
| `opening_line` | ✅ | the AI's first line, spoken at the start of Phase 2 |
| `seed_phrases[]` | optional | anchor phrases/key vocab for the topic |
| `intro_video_script` | optional | only if an intro video is wanted |
| `est_turns` | optional | rough length guide for the session |

---

## 4. Authoring process

```
Admin fills the scenario form
        │
        ├─ (optional) LLM drafts/polishes the spec from a short brief
        │        e.g. admin types "café ordering, B1" → LLM proposes setting/roles/goal/opening_line
        │
        ├─ lint / validate the spec (all required fields, sane level, opening_line present)
        │
        ├─ (optional) HyperFrames renders the intro video  (HTML composition → MP4), ONCE
        │        output stored as intro_video_url
        │
        └─ save  →  status: draft → published
```

- The LLM-draft step is a **convenience**, not required; an admin can hand-write everything.
- The HyperFrames render is **asynchronous** (it can take seconds–minutes). The scenario is
  publishable without a video; the video URL can be attached when the render completes.

---

## 5. Output — the `Scenario` record

The single reusable artifact this phase produces:

```json
{
  "id": "uuid",
  "title": "Ordering at a café",
  "topic": "food",
  "cefr_level": "B1",
  "setting": "A busy café at lunchtime.",
  "ai_role": "barista",
  "user_role": "customer",
  "goal": "Order a drink and a snack, and ask for the price.",
  "opening_line": "Hi there! What can I get for you today?",
  "seed_phrases": ["I'd like...", "How much is...", "for here or to go"],
  "intro_video_url": "https://.../scenarios/cafe-b1/intro.mp4",
  "status": "published",
  "version": 1,
  "created_by": "admin-uuid",
  "created_at": "2026-06-23T...Z",
  "updated_at": "2026-06-23T...Z"
}
```

**Versioning note:** because a scenario is reused by many learners and may be mid-session for
some, an edit to a published scenario should **bump `version`** (or create a new row) rather
than mutate in place, so in-flight sessions keep the spec they started with. Final mechanism
is an open question (§7).

This record is **fixed content** — created once, practiced by many. The only field that is
expensive to produce is `intro_video_url`, and it is reused by everyone.

---

## 6. Proposed API surface (admin-only)

All under `/v1/admin/scenarios`, guarded for the admin role. (To be reflected in
[docs/backend/api-endpoints.md](../backend/api-endpoints.md) and a per-feature frontend doc
when built.)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/admin/scenarios` | Create a scenario (draft) |
| `GET` | `/v1/admin/scenarios` | List scenarios (filter by topic, level, status) |
| `GET` | `/v1/admin/scenarios/:id` | Get one scenario |
| `PATCH` | `/v1/admin/scenarios/:id` | Edit (bumps version per §5) |
| `POST` | `/v1/admin/scenarios/:id/intro-video` | Trigger HyperFrames render (async) |
| `POST` | `/v1/admin/scenarios/:id/publish` | Publish a draft |
| `DELETE` | `/v1/admin/scenarios/:id` | Retire/soft-delete |

The learner-facing **read** endpoints (browse/recommend scenarios) belong to Phase 2.

---

## 7. Open questions

1. **Versioning mechanism** — bump a `version` column vs. immutable rows + a `published`
   pointer. Affects how in-flight sessions stay stable.
2. **Does v1 need video at all?** A scene card (title + setting + an image) plus the live
   conversation is already a complete experience. Shipping scenarios **without** HyperFrames
   first removes the render cost entirely; intro/recap videos become later polish.
3. **Intro video storage** — where MP4s live (S3-compatible bucket?) and how the URL is
   wired back after the async render.
4. **LLM-draft helper** — ✅ Resolved: built as `POST /v1/admin/scenarios/draft`, powered by
   **Groq `llama-3.1-8b-instant`** (not Gemma) via its own OpenAI-compatible client with key
   rotation ([src/common/groq/groq-request.ts](../../src/common/groq/groq-request.ts)). It is
   optional convenience — returns an unsaved spec to prefill the create form; manual authoring
   still works without it. See [admin_draft_scenario.md](../frontend/admin_draft_scenario.md).

---

## 8. Relationship to Phase 2

Phase 1's output (`Scenario`) is one of three runtime inputs to the Phase 2 conversation
prompt:

```
Scenario (admin, this phase)  +  user.cefr_level  +  selected_words[]  →  live LLM prompt
```

See [speaking_room_phase2_user_practice.md](speaking_room_phase2_user_practice.md) for the
live session flow, turn-taking, and where HyperFrames does / does not fit.
