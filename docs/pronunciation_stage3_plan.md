# Implementation Plan — Stage 3 (GOPT scoring head)

Companion to [pronunciation_scoring_design.md](pronunciation_scoring_design.md) and
[pronunciation_stage1_2_plan.md](pronunciation_stage1_2_plan.md). Stage 3 trains the head that
turns the per-phone **GOP feature vectors** (LPP) produced by Stage 2 into **calibrated 0–100
scores**, replacing the placeholder `gop_to_score` in [app/gop.py](../learning-vocab-pronunciation/app/gop.py).

**Where SpeechBrain finally earns its place:** this is the one stage trained in the `Brain` loop.

---

## 1. Input / output

```
per-phone LPP feature vectors  (from Stage 2, [L, V])  +  phone ids [L]
        │
        ▼
   GOPT transformer  ──►  per-phone accuracy in [0, 2]  ──► scaled to 0–100
        trained on speechocean762 phoneme labels (0/1/2), MSE loss, PCC metric
```

---

## 2. Data — speechocean762

- Source: HuggingFace `mispeech/speechocean762` (mirrors the OpenSLR corpus). Train/test = 2500/2500.
- Per utterance: audio, prompt text, and a `words` list; each word has `phones` (ARPAbet) and a
  per-phone accuracy label in **{0, 1, 2}** (2 = correct, 1 = accented, 0 = mispronounced).
- **Verify the exact field names on first run** (the inspector does this) — HF schemas vary on
  hyphenated keys like `phones-accuracy`.

---

## 3. The phone-set bridge (the key risk)

Our Stage-1 model is **espeak/IPA**; speechocean762 labels are **ARPAbet**. To attach each
label to a feature vector we map `ARPAbet → IPA → model-token-id`:

- `ARPAbet→IPA`: a fixed 39-phone table ([stage3/arpabet_ipa.py](../learning-vocab-pronunciation/stage3/arpabet_ipa.py)), stress digits stripped.
- `IPA→token`: reuse the Stage-2 maps (exact, then normalized). Multi-symbol IPA (diphthongs
  `aʊ`, affricates `tʃ`) is resolved by trying the whole symbol, then splitting into characters.
- **Expansion rule:** if one ARPAbet phone maps to 2 tokens, both inherit its label; if it maps
  to none, the phone (and its label) is **dropped** and counted.

**Coverage is a go/no-go gate.** Before building the model we run the inspector to report what
fraction of speechocean762 phones map. If coverage is poor on core English phones, that's a
signal the espeak model is the wrong Stage-1 choice for training and we revisit it — *not*
something to paper over.

---

## 4. Feature extraction (`stage3/extract_features.py`, after coverage is confirmed)

For each utterance:
1. Audio → 16 kHz → Stage-1 `log_posteriors` → `[T, V]`.
2. Concatenate word phones → one canonical sequence; bridge to token ids + a parallel label list.
3. `forced_align` + per-phone **LPP vector** (reuse Stage 2). **Guard:** if `len(spans) !=
   len(labels)` (adjacent identical tokens merged), skip the utterance and count it.
4. Cache per utterance: `features [L, V]`, `phone_ids [L]`, `labels [L]` (`torch.save`), and one
   manifest row. Caching means we extract once, then iterate on the model cheaply.

---

## 5. GOPT model (`stage3/model.py`)

A small transformer over the phone sequence:

```
LPP [L, V] ──Linear(V→d)──┐
                          (+)──► +positional ──► N× TransformerEncoder ──► Linear(d→1) ──► score[L]
phone_id [L] ──Embed(V→d)─┘
```

- `d_model≈64`, `nhead=4`, `layers≈3` (GOPT is deliberately small).
- Output regresses to `[0, 2]`; **MSE loss**, masked over padding.
- Inference: `score_0_100 = clamp(pred / 2 * 100)`.

---

## 6. SpeechBrain training recipe (`stage3/train.py` + `hparams/gopt.yaml`)

- `Brain` subclass: `compute_forward` runs GOPT on a padded batch; `compute_objectives` does
  masked MSE and accumulates preds/labels for **PCC**.
- Data: `DynamicItemDataset` from the manifest; a pipeline loads each cached `.pt`; `PaddedBatch`
  pads variable phone counts; lengths drive the mask.
- `Checkpointer` + LR anneal on validation PCC. Run:
  `python -m stage3.train stage3/hparams/gopt.yaml`.

---

## 7. Evaluation

- Primary: **phoneme-level PCC** on the test split (GOPT reference ≈ 0.61).
- Secondary: MSE; mispronunciation-detection F1 (label 0 vs >0 at a threshold).

---

## 8. Inference integration

Once trained, load the checkpoint in the service and replace `gop.gop_to_score`: the service
already emits LPP vectors per phone, so it feeds `[L, V]` + phone ids → GOPT → 0–100. **Stages
1–2 are untouched.**

---

## 9. Build order

1. **`inspect_dataset.py`** — confirm schema + **phone coverage** (the go/no-go gate). ← start here
2. `extract_features.py` — cache features + labels; report skip/drop counts.
3. `model.py` — GOPT, unit-tested on a synthetic batch.
4. `train.py` + `gopt.yaml` — train, watch PCC.
5. Swap the placeholder score map in the service.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Poor ARPAbet→espeak coverage | Coverage gate in step 1; revisit Stage 1 if core phones fail |
| Diphthong/affricate granularity (1 label → 2 tokens) | Expansion rule (both inherit label); measure how often |
| Peaky 1-frame spans → weak LPP | The head learns from them; GOP-AF remains an upgrade door |
| Domain gap (s762 clean vs app mic audio) | Internal calibration set later; augmentation |
| speechocean762 phone-label alignment edge cases | Skip-and-count guard in extraction |
