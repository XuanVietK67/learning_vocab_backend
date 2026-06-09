# Implementation Plan — Stage 3 Integration (serve the trained GOPT head)

Companion to [pronunciation_stage3_plan.md](pronunciation_stage3_plan.md). The GOPT head is
trained (**PCC 0.63** on speechocean762). This plan replaces the placeholder `gop_to_score` in
the scoring service with the trained model so `POST /score` returns **calibrated** per-phone
scores. All paths are in the `learning-vocab-pronunciation` service repo unless noted.

**Definition of done:** `/score` (and `scripts/score_file.py`) return GOPT-calibrated 0–100
per-phone scores; the earlier leniency (e.g. "thin → θ scored 82") is gone; a deliberately wrong
pronunciation scores clearly lower than a correct one.

---

## 1. The one rule: inference must mirror training exactly

The head was trained on **per-phone pooled wav2vec2 hidden states, standardized with train
`mean`/`std`**. Inference must reproduce the *same* feature, or scores are garbage:

```
audio + word
  → forward_features  → log_probs [T,V] (align) + hidden [T,H] (features)   # already exists
  → g2p(word) → espeak token ids                                            # already exists
  → align_spans(log_probs, token_ids) → spans (start,end per phone)         # already exists
  → pool hidden[start:end].mean(0) per phone → features [L, H=1024]
  → (features - mean) / std            # SAME stats as training  ← must persist
  → GOPT(features, phone_ids) → pred [L] in ~[0,2]
  → score = clamp(pred/2*100, 0, 100); label via thresholds
```

The two pieces that don't exist yet: the **persisted `mean`/`std`** and a **scorer that loads the
checkpoint and runs this path**.

---

## 2. Steps

### Step 1 — Persist normalization stats (train side)
- In `stage3/train.py`, after computing `mean, std`, save them next to the checkpoint:
  `torch.save({"mean": mean, "std": std}, <output_folder>/feature_stats.pt)`.
- Also persist the GOPT hyperparams used (`input_dim=1024`, `d_model`, `nhead`, `num_layers`) so
  the service can rebuild the model identically — save a small `model_config.json`, or read them
  from `gopt.yaml` at load time.
- **Retrain once** (a few minutes) to emit `feature_stats.pt` + a fresh best checkpoint.

### Step 2 — Inference scorer module (`app/scorer.py`)
- Load at service startup: rebuild `GOPT(input_dim, ...)`, load the **best** checkpoint
  (SpeechBrain saves `model.ckpt` per checkpoint; pick the one with max `PCC`, or use
  `Checkpointer.recover_if_possible(max_key="PCC")`), load `feature_stats.pt`, set `eval()`.
- `score(features, phone_ids) -> list[float]`: standardize → GOPT → clamp `pred/2*100`.

### Step 3 — Wire into the request path
- Refactor scoring so both `app/main.py` `/score` and `scripts/score_file.py` share one
  function that: decodes audio → `forward_features` → g2p → `align_spans` → pools hidden →
  scorer → assembles the response. (Today they call `align_and_score` + `gop_to_score`.)
- Keep the existing **audio quality gate**, **phone-set reconciliation** (422 on unmapped), and
  **time spans** in the output.

### Step 4 — Config + startup
- `app/config.py`: add `CHECKPOINT_DIR`, `FEATURE_STATS_PATH`, and a `USE_TRAINED_HEAD` flag
  (default true) so we can fall back to the placeholder if needed.
- `app/main.py` `lifespan`: load `Acoustic` **and** the scorer once; fail fast with a clear
  message if artifacts are missing.

### Step 5 — Ship the artifacts
- The Dockerfile currently `COPY app ./app` only. The image must also contain the **checkpoint**
  + **feature_stats.pt** (+ model_config). Options: `COPY` them into the image (simplest, ~MBs —
  the head is tiny, unlike the 1 GB wav2vec2 which still downloads at runtime), or mount a volume.
- Bump `MODEL_VERSION` (e.g. `gopt-wav2vec2-espeak-v1`).

---

## 3. Output contract changes

Mostly unchanged from [the design §2b]. Per phone: `phone`, `score` (now from GOPT), `label`,
`start_sec`, `end_sec`. The raw `gop` scalar becomes meaningless with the learned head —
**drop it** or rename to a debug-only field. `overall_score` = mean of per-phone scores.

---

## 4. Files

| File | Change |
|---|---|
| `stage3/train.py` | save `feature_stats.pt` (+ model config) |
| `app/scorer.py` | **new** — load GOPT + stats, `score()` |
| `app/score_pipeline.py` (or extend `app/gop.py`) | **new/edit** — shared audio→score function |
| `app/main.py` | load scorer in `lifespan`; `/score` uses the trained path |
| `app/config.py` | checkpoint/stats paths, `USE_TRAINED_HEAD` |
| `scripts/score_file.py` | use the shared scoring function |
| `Dockerfile` | COPY the checkpoint + stats into the image |
| `tests/test_scorer.py` | **new** — score mapping + a forward pass on a synthetic batch |

---

## 5. Testing

1. **Unit:** `pred/2*100` clamping + label thresholds; GOPT forward on a synthetic `[L,1024]`
   batch with loaded-shape stats.
2. **Smoke (real audio):** `score_file.py` on a clear "thin" vs a deliberately wrong one — the
   wrong phone must score clearly lower (the leniency regression test).
3. **Parity check:** features built at inference for one speechocean762 utterance should match the
   cached training features for that utterance (catches any pooling/normalization drift).

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Inference features differ from training (pooling/normalization drift) | Step-5 parity check against a cached training feature |
| Wrong/old checkpoint loaded | Select best by `PCC`; log the loaded path + PCC at startup |
| Model hyperparams mismatch on rebuild | Persist `model_config.json` from training; don't hardcode twice |
| Artifacts missing in image | Startup fails fast with a clear message; CI checks the files exist |
| Need to roll back | `USE_TRAINED_HEAD=false` falls back to the placeholder |

---

## 7. Build order

1. Add stats saving to `train.py`; **retrain once** → `feature_stats.pt` + best checkpoint.
2. `app/scorer.py` + unit test (synthetic batch).
3. Shared scoring function; switch `score_file.py` to it; smoke test on real audio.
4. Wire `/score` + `lifespan` loading + config flag.
5. Dockerfile artifacts + `MODEL_VERSION` bump; rebuild; container smoke test.
6. Parity check; then the NestJS proxy (separate — see design doc §8).

---

## 8. Out of scope (later)

- The **NestJS** `POST /v1/pronunciation/score` proxy + `pronunciation_attempt` table — tracked in
  [pronunciation_scoring_design.md](pronunciation_scoring_design.md) §8, done after the Python
  service serves the trained head.
- Quality upgrades (GOP-AF, larger head, word/sentence scores) — future iterations.
