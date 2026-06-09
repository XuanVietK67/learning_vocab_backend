# Implementation Plan — Stage 1 + 2 (Acoustic model + Aligned GOP)

Companion to [pronunciation_scoring_design.md](pronunciation_scoring_design.md). Covers the
**spike**: a standalone Python service that loads the frozen pretrained model (Stage 1),
force-aligns + computes GOP features (Stage 2), and returns rough per-phone scores. The GOPT
head (Stage 3) is **out of scope here** — but Stage 2 already emits the feature vectors it will
consume, so adding Stage 3 later is additive.

**Definition of done:** `POST /score` accepts a wav + word and returns per-phone GOP, time
spans, and a placeholder 0–100 score, verified on a handful of real recordings.

---

## 1. Repo & layout

New, separate repo `learning-vocab-pronunciation` (no Python deps in the NestJS project).

```
pronunciation-service/
├── app/
│   ├── main.py        # FastAPI app + POST /score
│   ├── config.py      # settings (model id, sample rate, thresholds)
│   ├── audio.py       # decode → mono 16 kHz, basic quality gate
│   ├── acoustic.py    # Stage 1: load model, audio → log-posteriors
│   ├── g2p.py         # G2P (espeak) + phone→token-id map (reconciliation)
│   ├── gop.py         # Stage 2: forced align + GOP feature vectors
│   └── schema.py      # pydantic response models (the §2b contract)
├── tests/
│   ├── test_phone_map.py
│   ├── test_gop.py
│   └── data/sample.wav
├── requirements.txt
├── Dockerfile
└── README.md
```

---

## 2. Dependencies

```
torch>=2.1
torchaudio>=2.1          # forced_align + merge_tokens live here
transformers>=4.38
phonemizer>=3.2          # needs espeak-ng installed at the OS level
soundfile
numpy
fastapi
uvicorn[standard]
python-multipart         # FastAPI file uploads
```

**OS dependency:** `espeak-ng` must be installed (`apt-get install espeak-ng` in the
Dockerfile). On Windows dev, install espeak-ng and set `PHONEMIZER_ESPEAK_LIBRARY` if needed —
or just develop the model bits in Docker/WSL.

---

## 3. Stage 1 — `acoustic.py`

Load once at startup, frozen, `eval()`:

```python
from transformers import AutoProcessor, Wav2Vec2ForCTC
import torch

MODEL_ID = "facebook/wav2vec2-xlsr-53-espeak-cv-ft"

class Acoustic:
    def __init__(self):
        self.processor = AutoProcessor.from_pretrained(MODEL_ID)
        self.model = Wav2Vec2ForCTC.from_pretrained(MODEL_ID).eval()
        self.blank_id = self.processor.tokenizer.pad_token_id   # CTC blank
        self.vocab = self.processor.tokenizer.get_vocab()       # phone -> id
        self.id2phone = {i: p for p, i in self.vocab.items()}

    @torch.no_grad()
    def log_posteriors(self, wav_16k):                          # wav: 1-D float tensor @16k
        inputs = self.processor(wav_16k, sampling_rate=16000, return_tensors="pt")
        logits = self.model(inputs.input_values).logits[0]      # [T, V]
        return logits.log_softmax(-1)                           # [T, V]
```

Notes:
- **Frame rate:** wav2vec2 stride = 320 samples @16 kHz → **20 ms/frame**. `time = frame*0.02`.
- Output `[T, V]` log-posteriors is the *only* thing Stage 2 needs.

**Tasks**
- [ ] Implement `Acoustic` (load, `log_posteriors`).
- [ ] Confirm `blank_id` (pad token) and pass it to `forced_align`.

---

## 4. G2P + phone-set map — `g2p.py`

The make-or-break reconciliation step. The model's vocab and phonemizer's espeak output must
line up.

```python
from phonemizer import phonemize
from phonemizer.separator import Separator

def g2p(word: str) -> list[str]:
    out = phonemize(word, language="en-us", backend="espeak",
                    separator=Separator(phone=" ", word="|"),
                    strip=True, with_stress=False)              # drop ˈ ˌ
    return [p for p in out.replace("|", " ").split() if p]
```

Then map each phone string → token id in the model vocab:

```python
def build_phone_to_id(vocab: dict[str, int]) -> dict[str, int]:
    norm = {normalize(p): i for p, i in vocab.items()}          # strip stress/length marks
    return norm

def to_token_ids(phones, phone_to_id):
    ids, unmapped = [], []
    for p in phones:
        key = normalize(p)
        (ids.append(phone_to_id[key]) if key in phone_to_id else unmapped.append(p))
    return ids, unmapped
```

**Tasks**
- [ ] `normalize()` — strip stress (`ˈ ˌ`), length (`ː`), combining diacritics; decide whether
      to split affricates (`tʃ`) or keep as single tokens to match the vocab.
- [ ] `build_phone_to_id()` from the model vocab once at startup.
- [ ] Log `unmapped` phones loudly — they mean a broken score, not a low score.
- [ ] **Unit test** (`test_phone_map.py`): a word list → every phone maps to a real id; assert
      zero unmapped on a 200-word smoke list.

---

## 5. Stage 2 — `gop.py` (forced align + GOP features)

```python
import torch
from torchaudio.functional import forced_align, merge_tokens

def align_and_score(log_probs, token_ids, id2phone, blank_id, frame_sec=0.02):
    targets = torch.tensor([token_ids], dtype=torch.int32)
    emission = log_probs.unsqueeze(0)                           # [1, T, V]
    aligned, scores = forced_align(emission, targets, blank=blank_id)
    spans = merge_tokens(aligned[0], scores[0])                # one TokenSpan per target phone

    results = []
    for span in spans:                                         # span.token, .start, .end
        seg = log_probs[span.start:span.end + 1]               # [span_len, V]
        lpp = seg.mean(0)                                       # [V]  mean log-post per phone
        p = span.token
        gop = (lpp[p] - lpp.max()).item()                      # ratio form (≤ 0)
        results.append({
            "phone": id2phone[p],
            "start_sec": span.start * frame_sec,
            "end_sec":  (span.end + 1) * frame_sec,
            "gop": gop,                                         # scalar
            "lpp": lpp.tolist(),                               # feature vector for Stage 3
        })
    return results
```

Notes / gotchas:
- `forced_align` needs `targets` int32, no blank inside; `len(targets) ≤ T`.
- **CTC peakiness:** spans may be 1 frame → `lpp` is noisy. Acceptable for the spike; it's the
  documented reason for the GOP-AF upgrade door.
- Keep `lpp` (and later LPR = `lpp[p] - lpp[q]`) — that's the **feature vector Stage 3 (GOPT)
  consumes**. Don't throw it away even though the spike only uses the scalar.

**Tasks**
- [ ] Implement `align_and_score`.
- [ ] Placeholder score map (until Stage 3): e.g. `score = clip(round(100*sigmoid(a*gop+b)))`
      with hand-tuned `a,b` — explicitly marked as a stand-in for the trained head.
- [ ] **Unit test** (`test_gop.py`): on `sample.wav` + its word, assert one result per canonical
      phone, spans monotonic & within audio length, gop ≤ 0.

---

## 6. Audio + quality — `audio.py`

```python
def load_16k_mono(file_bytes) -> torch.Tensor      # soundfile → resample → mono float32 @16k
def quality(wav) -> dict                            # duration, rough SNR, clipping flag
```

**Tasks**
- [ ] Decode any uploaded format → mono, resample to 16 kHz.
- [ ] Reject too-short / silent clips early (return a clear error, not a fake score).

---

## 7. API — `main.py` + `schema.py`

```
POST /score
  multipart: audio=<file>, word=<str>
  200 → { word, transcript_phonemes, overall_score, phonemes[ {phone, score, gop,
          start_sec, end_sec} ], audio_quality, model_version }
  422 → bad/empty audio or unmappable phones
```

`overall_score` = mean of per-phone scores (placeholder until Stage 3).

**Tasks**
- [ ] Pydantic response models mirroring §2b of the design doc (+ `gop`, `start_sec`,
      `end_sec`, `lpp` optional/debug-only).
- [ ] Wire startup: build `Acoustic` + phone map once; reuse per request.
- [ ] `GET /health`.

---

## 8. Build order (smallest steps first)

1. `acoustic.py` + a throwaway CLI: print top phones per frame for `sample.wav` → confirms the
   model loads and emits sane posteriors.
2. `g2p.py` + `test_phone_map.py` → confirm **zero unmapped** phones (the riskiest bit).
3. `gop.py` + `test_gop.py` → spans + GOP on `sample.wav`.
4. `audio.py` → real uploads (resample/decode/quality).
5. `main.py` → `/score`, `/health`; manual check on a few recordings (good vs deliberately
   wrong pronunciation — GOP should drop on the wrong phone).
6. `Dockerfile` (with `espeak-ng`) → container runs `/score`.

---

## 9. Done = ready for Stage 3

When this spike works, Stage 3 plugs in by: collecting `lpp`/LPR feature vectors per phone over
speechocean762, training the GOPT head, and replacing the **placeholder score map** in §5 with
the head's output. No changes to Stages 1–2 are required.
