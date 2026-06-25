# Plan: Speaking Room — Phase 2 (User Practice Session)

Status: **Phase 2a/2b implemented (text loop + report)** · Owner: TBD · Last updated: 2026-06-25

> **Implementation status (2026-06-25).** The text-only turn loop and the
> end-of-session report are built and shipped as the learner-facing surface under
> `/v1/speaking` ([speaking-session.controller.ts](../../src/speaking-room/speaking-session.controller.ts)):
> browse published scenarios, start a session, take REST turns, end → report.
> Per §5 the turn LLM returns `{reply, corrections, used_target_words}` (Groq
> `GROQ_CHAT_MODEL`); the report uses the larger `GROQ_REPORT_MODEL`. Decisions
> taken: **REST per turn for v1** (push-to-talk is request/response; the streaming
> WebSocket in §7 is deferred to 2e), report generated **synchronously on `end`**
> (not queued), and the scenario spec is **snapshotted onto the session** at start
> so an admin edit can't mutate an in-flight conversation. **Not yet built:** STT
> (2c), TTS/VoxCPM (2d), WebSocket streaming + VAD + intro/recap video (2e).

The **Speaking Room** lets a learner practice spoken English in a live, turn-based voice
conversation with an AI partner. This document covers **Phase 2 — the live practice
session**: how a learner runs a scenario, how turn-taking works, and exactly where
HyperFrames does and does not fit. Phase 1 (admin scenario authoring) is in
[speaking_room_phase1_admin_authoring.md](speaking_room_phase1_admin_authoring.md).

Core principle carried over from Phase 1:

> **Admin owns the fixed assets (scenario + intro/recap video). The learner's CEFR level and
> chosen words only change the live LLM prompt — they cost nothing and need no rendering.**

---

## 1. Goal & scope

### In scope (Phase 2)
- Browse/recommend admin-authored scenarios; recommend ones matching the deck a user studies.
- Run a **live, turn-based voice conversation**: AI speaks → waits → user speaks → AI replies.
- Personalize each turn by **CEFR level** (how the AI talks) and **selected target words**
  (woven in as soft goals).
- Show **corrections as on-screen text** without interrupting the spoken flow.
- Produce an **end-of-session feedback report**.

### Out of scope (Phase 2)
- Authoring scenarios or rendering intro videos — Phase 1.
- A **real-time talking-head avatar during the conversation.** HyperFrames cannot do live
  video; that would require a streaming-avatar product (e.g. HeyGen) and is a later option.
- Barge-in / interrupting the AI mid-sentence (v1 is strictly turn-based).

### Success criteria
- A learner can complete a full session: setup → intro → multi-turn conversation → report.
- Perceived round-trip latency (user finishes speaking → AI starts speaking) stays low by
  **streaming** the LLM and piping finished sentences to TTS (see §5).
- The same scenario produces a different, level-appropriate conversation for different users,
  with **no extra rendering**.

---

## 2. The pipeline (one turn)

The live conversation is **not a video** — it is a voice loop built from three components:

```
🎤 user audio ──► [STT] ──► transcript ──► [LLM brain] ──► reply (+corrections)
                                                              │
                                                              ├─► [TTS: VoxCPM 2] ─► 🔊 spoken reply
                                                              └─► corrections shown as text
```

- **STT** — speech → text (e.g. Whisper, self-hosted).
- **LLM brain** — the conversation partner + tutor (free tier: Groq `llama-3.1-8b-instant`,
  or the existing Gemma client with key rotation).
- **TTS** — VoxCPM 2 turns the reply text into 48 kHz speech. **TTS only** — it does not
  listen or decide what to say; STT + LLM are required and separate.

---

## 3. End-to-end session flow

### Phase 2.1 — Setup
```
User picks a Scenario  +  picks which words to practice (from their decks)
User's CEFR level → read automatically from their profile
        └──────────► backend builds the conversation context (the LLM system prompt)
```
Runtime inputs to the prompt: `scenario (admin)` + `user.cefr_level` + `selected_words[]`.

### Phase 2.2 — Intro video (HyperFrames, optional)
The intro video **plays once, start to finish, like a cutscene.** It is *not* interactive and
does *not* wait for input — it just sets the scene:

> *"You walk into a busy café. The barista looks up and smiles…"*

When it ends → switch to the conversation screen. If a scenario has no video, show a **scene
card** instead (fine for v1).

### Phase 2.3 — Live conversation loop

There is **no video to pause here.** The conversation is a turn-based voice loop with a
simple talking UI (a static character image or basic lip-sync + a "speaking…" indicator).

```
┌─────────────────────────────────────────────────────────────┐
│ 1. AI speaks first      VoxCPM plays scenario.opening_line    │
│       🔊 "Hi there! What can I get for you today?"            │
│                                                               │
│ 2. User's turn          UI shows "🎤 Your turn"              │
│       user talks into the mic                                 │
│                                                               │
│ 3. Detect end-of-turn   (push-to-talk or VAD — see §4)        │
│ 4. STT  → transcript                                          │
│ 5. LLM  → reply (+corrections), using level + target words    │
│ 6. VoxCPM → speaks the reply                                  │
│ 7. corrections shown on screen as text (NOT spoken)           │
│                                                               │
│        └────────── repeat 2–7 until goal met ────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

**When does it wait?** After the AI finishes speaking, it waits for the user. The rhythm is
strictly **AI speaks → waits → user speaks → AI replies.** No interrupting in v1.

### Phase 2.4 — End of session
```
Session ends ──► one slower LLM call over the full transcript (use a smarter model here)
            ──► feedback report: top mistakes, target words actually used,
                level estimate, what to practice next
            ──► (optional) HyperFrames renders the report as a recap video
```

---

## 4. Turn-taking: how we know the user finished

| Method | How it works | Best for | v1? |
|---|---|---|---|
| **Push-to-talk** | User holds/taps a "Speak" button, talks, releases | Learners — they pause mid-sentence; no risk of being cut off | ✅ recommended |
| **VAD (auto)** | System detects ~1.5 s of silence = done | More natural, hands-free; can cut off hesitant speakers | later |

For English learners, **start with push-to-talk** — it gives them time to think and is the
simplest to build reliably. Add VAD later for a more natural feel.

---

## 5. The LLM prompt & output contract

The system prompt merges the three runtime inputs. Target words are **soft goals**, not a
script — "use these when they fit naturally," not "use all of them."

```
You are {ai_role} in this scenario: {setting}. The user plays {user_role}.
Goal of the conversation: {goal}.

Rules:
- The user's level is {cefr_level}. Use vocabulary/grammar at that level — never harder.
  Their native language is Vietnamese.
- Keep replies SHORT (1–3 sentences) and ALWAYS end with a question to keep them talking.
- Stay in character. Do NOT interrupt the flow to correct grammar.
- Naturally use these target words when they fit: {selected_words}.

Return JSON:
{
  "reply": "<what you say, in character>",
  "corrections": [{ "user_said": "...", "better": "...", "why": "..." }],
  "used_target_words": ["..."]
}
```

The split is intentional: **`reply` → VoxCPM (spoken)**, **`corrections` → on-screen text**.
This teaches without breaking the conversational flow.

**Latency tactics (the round-trip, not the model, is the bottleneck):**
1. **Stream** LLM tokens — do not wait for the full reply.
2. Pipe each **finished sentence** straight to VoxCPM while the LLM keeps generating.
3. Keep replies short (the prompt already enforces 1–3 sentences).
4. Free-tier rate limits are fine for a single-user demo; key rotation buys headroom for more.

---

## 6. Where HyperFrames fits (and doesn't)

```
[Intro video] ─► [LIVE voice conversation: STT + LLM + VoxCPM] ─► [Recap video]
  HyperFrames          NOT HyperFrames — real-time loop            HyperFrames
  (pre-rendered)       (static avatar / lip-sync UI)               (pre-rendered)
```

HyperFrames only does the **bookends** (intro + recap), which are pre-rendered and
non-interactive. The actual talking is a live voice loop. A real-time talking avatar *during*
the conversation is a different tool (streaming avatar), out of scope for v1.

---

## 7. Proposed API / transport surface

The live loop is best over a **WebSocket** (or WebRTC for audio); the bookends are plain REST.
(To be reflected in [docs/backend/api-endpoints.md](../backend/api-endpoints.md) and a
per-feature frontend doc when built.)

| Transport | Endpoint | Purpose |
|---|---|---|
| `GET` | `/v1/speaking/scenarios` | Browse/recommend published scenarios (matches user's decks) |
| `POST` | `/v1/speaking/sessions` | Start a session: pick scenario + selected words → returns session id + opening line |
| WebSocket | `/v1/speaking/sessions/:id/stream` | The live turn loop: send user audio/transcript, receive reply audio + corrections |
| `POST` | `/v1/speaking/sessions/:id/end` | End session → generate feedback report (+ optional recap video) |
| `GET` | `/v1/speaking/sessions/:id/report` | Fetch the end-of-session report |

---

## 8. Open questions

1. **STT placement** — self-hosted Whisper microservice (like the pronunciation service) vs.
   a hosted STT. Affects latency and GPU budget.
2. **VoxCPM hosting** — real-time needs ~a 4090-class GPU. v1 could use a hosted TTS to avoid
   GPU cost, then move to self-hosted VoxCPM 2 later.
3. **Push-to-talk vs. VAD** — confirm push-to-talk for v1 (recommended) before building VAD.
4. **Session persistence** — how much transcript/correction history to store (ties into the
   vocab platform's progress data) for the report and future review.
5. **Recap video** — whether to render it synchronously after the session or lazily on demand.

---

## 9. Relationship to Phase 1

This phase consumes the `Scenario` produced in Phase 1 and layers per-user data on top at
runtime:

```
Scenario (admin, Phase 1)  +  user.cefr_level  +  selected_words[]  →  live LLM prompt
```

See [speaking_room_phase1_admin_authoring.md](speaking_room_phase1_admin_authoring.md) for
the scenario fields and authoring flow.
