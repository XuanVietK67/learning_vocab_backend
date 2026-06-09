# Design: Phoneme-Level Pronunciation Scoring (SpeechBrain)

Status: **Draft — build path decided** · Owner: TBD · Last updated: 2026-06-08

A design for adding **pronunciation scoring** to the learning-vocab platform: a learner
records themselves saying a target word; the system returns a **0–100 score per phoneme**
plus a feedback label (e.g. `/s/` → 80 "good", `/t/` → 50 "practice more"), built on
[SpeechBrain](https://github.com/speechbrain/speechbrain).

---

## 1. Goal & scope

### In scope (v1)
- Input: a learner's audio clip + the **target word** (text) they were asked to say.
- Output: per-phoneme score `0–100`, a coarse feedback label, and an overall word score.
- English only.
- Model runs as a **separate Python microservice**; the NestJS backend calls it over HTTP.

### Out of scope (v1)
- Sentence-level fluency/prosody/intonation scoring (planned v2).
- Non-English languages.
- On-device / in-browser inference.
- Real-time streaming scoring (we score complete clips only).

### Success criteria
- Phoneme-level score correlates with expert judgement: **Pearson correlation (PCC) ≥ 0.6**
  on the speechocean762 phoneme test set (GOPT baseline is ~0.61).
- p95 scoring latency **< 1.5 s** for a single word on the target hardware.
- Robust to phone-recorded audio (16 kHz, mild background noise).

---

## 2. Chosen build path (decisions — 2026-06-08)

The **minimal-SpeechBrain** path was chosen, stage by stage, after weighing trade-offs:

| Stage | Decision | Rationale & upgrade door |
|---|---|---|
| **1. Acoustic model** | **Pretrained, frozen** `wav2vec2-xlsr-53-espeak-cv-ft` — no training | Fastest to a working model; needs no licensed data (TIMIT is paid). **Upgrade door:** fine-tune in SpeechBrain later *only if* error analysis shows Stage 1 is the bottleneck. |
| **2. Alignment + GOP** | **Aligned GOP** via `torchaudio.functional.forced_align` + ratio formula | Simplest path to real numbers; yields per-phone **time spans** (useful for UI). **Upgrade door:** swap to alignment-free GOP-AF if CTC peakiness hurts. |
| **3. Scoring head** | **GOPT transformer**, trained in SpeechBrain's `Brain` loop | Best quality / documented speechocean762 SOTA; sequence-aware. This is the stage SpeechBrain is actually used for. |

**Consequence for the stack:** with a frozen Stage 1 and torchaudio alignment, **SpeechBrain is used only for Stage 3 (the GOPT head)**. That is deliberate, not accidental — the rest is HuggingFace + torchaudio + numpy.

**Phone-set consequence:** the pretrained model emits **espeak/IPA** phones, *not* ARPAbet. The canonical G2P must therefore also be espeak/IPA so GOP can index the right posterior column; ARPAbet is used only for display (see §3).

---

## 2b. Output contract

The scoring service returns this shape (also what the NestJS endpoint re-exposes):

```json
{
  "word": "thin",
  "transcript_phonemes": ["DH", "IH", "N"],
  "overall_score": 72,
  "phonemes": [
    { "phone": "DH", "score": 80, "label": "good" },
    { "phone": "IH", "score": 88, "label": "good" },
    { "phone": "N",  "score": 50, "label": "practice" }
  ],
  "audio_quality": { "snr_db": 24.1, "too_short": false, "clipping": false },
  "model_version": "gop-wav2vec2-espeak-v1"
}
```

### Score scale & labels
- Train against speechocean762 phoneme labels (`0 / 1 / 2`). Map model output to `0–100`.
- Feedback label thresholds (tunable, surfaced as config not hard-coded):
  - `score ≥ 75` → `good`
  - `45 ≤ score < 75` → `practice`
  - `score < 45` → `wrong`

---

## 3. Phoneme set & G2P

Because Stage 1 is the frozen **espeak** model, the internal phone set is **espeak/IPA**, and
the canonical G2P must match it so GOP can index the right posterior column.

- **Internal (scoring):** espeak/IPA. Canonical phones via `phonemizer` (espeak backend,
  `en-us`).
- **Phone-set reconciliation:** normalize stress (`ˈ ˌ`), diacritics, and length marks (`ː`)
  consistently on *both* the G2P output and the model's token vocab, and exclude the CTC
  **blank**. Build a `canonical-phone → token-id` map once at startup — this is the most
  error-prone part of Stage 2, more than the GOP math itself.
- **Display (API):** optionally map espeak/IPA → **ARPAbet/CMU** for a friendlier label set in
  the response (e.g. `ð`→`DH`). Presentation only — never used for scoring.
- Words with multiple valid pronunciations: score against **each** candidate and keep the
  best-scoring alignment so a learner isn't penalised for a legitimate variant.

---

## 4. Data

| Dataset | Use | Notes |
|---|---|---|
| [speechocean762](https://github.com/jimbozhang/speechocean762) | Train/eval the scoring head | 5,000 non-native English utterances, phoneme/word/sentence labels, free on OpenSLR |
| TIMIT or LibriSpeech (+G2P) | Optional: train/finetune the phoneme acoustic model | Only needed if not using the pretrained espeak model |
| Internal learner recordings | Domain adaptation / calibration | Collected via the app once live; mind consent + storage policy |

**Label mapping:** speechocean762 phoneme accuracy is `0/1/2`. Treat as ordinal regression
target; scale predictions to `0–100`.

---

## 5. Model architecture

Three stages (see §2 for the chosen path per stage).

```
target word ──► [G2P espeak/IPA] ──► canonical phones (e.g. ð ɪ n)
                                   │
learner audio ──► [1] pretrained wav2vec2+CTC (frozen, espeak) ──► frame log-posteriors [T,V]
                                   │
                          [2] forced-align + GOP feature vector per phone (LPP/LPR)
                                   │
                          [3] GOPT transformer ──► 0–100 + label per phone
```

### Stage 1 — Acoustic model (phoneme recognizer) — *pretrained, frozen*
- Load `facebook/wav2vec2-xlsr-53-espeak-cv-ft` (HuggingFace `Wav2Vec2ForCTC`) once at
  startup, `eval()` mode. No training, no SpeechBrain here.
- Per request: `log_probs = log_softmax(model(audio).logits)` → `[T_frames, V_phones]`. These
  per-frame log-posteriors are the only thing downstream stages consume.

### Stage 2 — Alignment + GOP — *aligned GOP*
- **Forced-align** the canonical phone sequence to frames with
  `torchaudio.functional.forced_align` over the model's emissions (also yields per-phone time
  spans for the UI).
- For each canonical phone `p`, over its aligned frame span, compute a **GOP feature vector**
  (not just a scalar) to feed Stage 3:
  - **LPP** — mean log-posterior of every phone over the span (a `V`-dim vector),
  - **LPR** — `LPP(p) − LPP(q)` for competitors (how much `p` is favored),
  - plus scalar **GOP(p)**, phone **identity**, and **duration**.
- **Upgrade door:** alignment-free GOP-AF if CTC peakiness degrades the spans — see
  [Segmentation-Free GOP, 2025](https://arxiv.org/html/2507.16838) and
  [GOP + phonological knowledge, 2025](https://arxiv.org/pdf/2506.02080).

### Stage 3 — Scoring head — *GOPT, in SpeechBrain*
- Input: the per-phone GOP **feature vectors** from Stage 2, as a sequence.
- Model: **GOPT** — a transformer over the phone sequence (context-aware: a phone's score
  depends on its neighbours, position, and word). The standard speechocean762 scorer.
- Trained in SpeechBrain's `Brain` loop (transformer layers + checkpointing) on speechocean762
  phoneme labels (`0/1/2`) as an **MSE regression**; evaluate with PCC.
- Output: per-phone continuous score → linearly scaled to `0–100`; thresholds (§2b) produce
  the feedback label. Word/sentence heads can be added later from pooled representations.

---

## 6. Inference pipeline (per request)

1. Decode audio → mono PCM, resample to **16 kHz**.
2. Quality gate: VAD (drop silence), check duration/SNR/clipping → set `audio_quality`.
3. G2P the target word → canonical phonemes.
4. Acoustic model → frame posteriors.
5. Align + compute GOP per phoneme.
6. Scoring head → per-phoneme `0–100` + overall word score.
7. Apply label thresholds, assemble the JSON contract, return.

---

## 7. Serving

- **Framework:** FastAPI (Python), one model loaded in memory at startup.
- **Endpoint:** `POST /score` — multipart (audio file) + `word` field → JSON contract above.
- **Deployment:** containerised; GPU optional (CPU is fine for single-word latency).
- **Repo:** separate from this NestJS repo (e.g. `learning-vocab-pronunciation`), so Python
  deps don't enter the Node project.

---

## 8. NestJS integration (this repo)

A thin proxy + persistence layer. **No PyTorch in Node.**

- **New module:** `src/pronunciation/`
  - `POST /v1/pronunciation/score` — accepts learner audio + `vocabularyId` (or `word`),
    forwards to the Python service, stores the attempt, returns the result.
  - `GET /v1/pronunciation/attempts` — learner's history for a word (for progress UI).
- **DTOs:** request (`word`/`vocabularyId`, audio upload), response mirrors the contract.
- **Storage:** `pronunciation_attempt` table — `id` (uuid), `user_id`, `vocabulary_id`,
  `overall_score`, `phoneme_scores` (jsonb), `audio_url` (if retained), `model_version`,
  `created_at` (timestamptz). Follows repo conventions (uuid PKs, snake_case, timestamptz).
- **Config:** `PRONUNCIATION_SERVICE_URL` env var; timeout + retry around the HTTP call.
- **Docs to update on implementation** (per repo rules):
  - Add rows to [docs/api-endpoints.md](docs/api-endpoints.md).
  - Add a per-feature frontend doc `docs/pronunciation_score.md` + link it from
    [docs/frontend_handoff.md](docs/frontend_handoff.md).

---

## 9. Evaluation

- **Primary metric:** Pearson correlation (PCC) of predicted vs expert phoneme scores on
  the speechocean762 test split.
- **Secondary:** word-level PCC; mispronunciation detection F1 (phones scored `0`).
- **Operational:** latency p50/p95, error rate, audio-rejection rate.
- Hold out a small **internal learner set** for real-world sanity checks (clean test set ≠
  noisy phone audio).

---

## 10. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Raw GOP isn't a user-friendly score | Confusing grades | Calibrate via the speechocean762-trained head, not raw GOP |
| Clean training data vs noisy mic audio | Score drift in production | 16 kHz pipeline, VAD, noise augmentation, internal calibration set |
| Forced-alignment errors / CTC peakiness | Wrong per-phoneme blame | v1 uses aligned GOP; upgrade door to alignment-free GOP-AF if spans are noisy |
| espeak ↔ phonemizer token mismatch | GOP indexes wrong column → garbage scores | Build + unit-test the `phone → token-id` map; normalize stress/diacritics on both sides |
| Child / strong-accent bias | Unfair scores | speechocean762 includes children; monitor by cohort, collect internal data |
| Multi-pronunciation words | False negatives | Score all pronunciation variants (phonemizer/lexicon), keep best |
| Latency on CPU | Slow UX | Single-word clips; quantise/cache model; GPU if needed |

---

## 11. Milestones

1. **Spike** — pretrained espeak acoustic model + simple GOP; eyeball scores on sample audio.
2. **Baseline** — train GOPT-style head on speechocean762; report PCC.
3. **Service** — FastAPI `/score` returning the contract; dockerise.
4. **Backend** — NestJS `pronunciation` module, DB table, proxy endpoint (mock → real).
5. **Hardening** — audio quality gate, calibration, alignment-free GOP, latency tuning.
6. **Pilot** — collect internal recordings, calibrate, evaluate, iterate.

---

## 12. References

- SpeechBrain — https://github.com/speechbrain/speechbrain
- speechocean762 corpus + Kaldi GOP baseline — https://github.com/jimbozhang/speechocean762
- GOPT (transformer phoneme scorer) — Gong et al., "Transformer-Based Multi-Aspect
  Multi-Granularity Non-Native English Speaker Pronunciation Assessment"
- Segmentation-Free GOP (2025) — https://arxiv.org/html/2507.16838
- GOP + phonological knowledge (2025) — https://arxiv.org/pdf/2506.02080
- Pretrained multilingual phoneme model — `facebook/wav2vec2-xlsr-53-espeak-cv-ft`
