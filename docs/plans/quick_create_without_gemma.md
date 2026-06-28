# Quick-create vocabulary without Gemma (production-ready)

**Status:** implemented (phases 1–5; Gemma fallback on by default until data is
loaded) · **Owner:** vocabularies module · **Created:** 2026-06-28

## Goal

Let a user (or admin) quick-create a vocabulary from just a lemma **without any
dependence on the Gemma API**, and have every field come from a source that is
production-ready: deterministic, self-hostable or behind a stable paid API,
cacheable, and degrading gracefully to an editable empty field on a miss.

Gemma stays only as an **optional last-resort fallback** behind a feature flag
(see [Rollout](#rollout)); the steady-state path never calls it.

## Why

- **Cost / rate limits.** The current worker is built around Gemma's free-tier
  RPM: a key-rotation list, an RPM limiter, request **batching** to coalesce up
  to 5 words per call, and exponential backoff with jitter for `429`/`503`
  spikes ([enrichment.processor.ts](../../src/vocabularies/enrichment/enrichment.processor.ts)).
  That machinery exists purely to survive a dependency we don't control.
- **Reliability.** A Gemma outage today fails enrichment for every word.
- **Quality is uneven** on the generative fields, and the model can hallucinate
  definitions/examples for rare or non-English words.

## Current flow (what Gemma does today)

Quick-create is async: the controller creates a `VocabEnrichmentJob` (PENDING)
and enqueues it; a BullMQ worker fills the fields and lands one draft vocabulary
per part of speech
([vocabularies.service.ts](../../src/vocabularies/vocabularies.service.ts) →
[enrichment.processor.ts](../../src/vocabularies/enrichment/enrichment.processor.ts)).

Inside the worker, `generateDrafts` has two paths:

| Path | When | Source of each field |
|---|---|---|
| **Dictionary-assisted** (`draftsFromDictionary`) | `language === 'en'` **and** dictionary has the entry | POS, definition, IPA, synonyms, antonyms, dict example → **dictionary**; gloss, ≥2 examples, CEFR, translation → **Gemma** |
| **From scratch** (`draftsFromScratch`) | non-English, or dictionary miss | POS, definition, gloss, examples, CEFR, translation → **Gemma**; IPA → dictionary-composed (en phrases) else **Gemma** |

So Gemma owns **gloss, examples, CEFR, translation** on the happy path, and the
**entire structure** on the fallback path. This plan replaces each of those.

## Target architecture — field by field

| Field | New source | Generative? | Production notes |
|---|---|---|---|
| `partsOfSpeech` | Dictionary | No | already done for `en`; extend to multilingual via Wiktionary |
| `definition` | Dictionary | No | same |
| `ipa` | Dictionary (G2P fallback) | No | already composed from per-word lookups; `espeak-ng` as last resort |
| `example` | **Corpus retrieval** | No | concordance over Tatoeba/OpenSubtitles + a "good example" filter |
| `translation` | **Dictionary lookup → OPUS-MT → cache** | No | word/sense-level; see below |
| `cefr` | **Frequency mapping** | No | derive from `frequency_rank` (already stored) + EVP bands |
| `gloss` | Optional, user-editable | — | derive first word(s) of definition, or leave blank |
| `image` | Optional, user-editable | — | external image API (Unsplash/Pixabay), not auto-required |
| `audio` | TTS (already async) | — | unchanged — [audio-queue.producer.ts](../../src/vocabularies/audio/audio-queue.producer.ts) |

Unifying principles: **lookup/retrieval over generation**, **cache every
deterministic result**, **graceful fallback to an editable empty field**, **no
self-trained model**.

## Per-field design

### Examples — corpus retrieval

Replace Gemma example generation with a **concordance**: index a clean sentence
corpus and, for a `(lemma, sense)`, retrieve real sentences that contain the
lemma or an inflected form.

- **Corpus:** Tatoeba (CC-licensed, multilingual, sentence-segmented) as the
  primary; OpenSubtitles (OPUS) to widen coverage. **Not** YouTube auto-captions
  or social media (ASR noise, wrong register, safety, ToS).
- **Index:** Postgres full-text or a dedicated search index; lemma-keyed.
- **"Good example" filter (GDEX-style):** length ~5–20 words, target word
  present and central, single clause, common vocabulary, no rare proper nouns /
  profanity, self-contained. This filter drives quality more than the corpus.
- **Sense caveat:** a retrieved sentence won't know *which* sense it shows. For
  quick-create this is acceptable because the field is **editable**; pick the
  highest-ranked sentence for the most frequent sense and let the user adjust.
- **Miss policy:** no hit → leave examples empty (user adds later). Never block.

### Translation — lookup first, OPUS-MT fallback, always cached

The field is **word/sense-level** ("short translation of the lemma for that
sense"), so a bilingual **dictionary lookup is more accurate than MT** and needs
no model:

1. **Lookup** in a bilingual lexicon (Wiktionary translation tables via
   wiktextract/DBnary, or PanLex — CC0). Prefer sense-keyed entries; disambiguate
   with the definition where possible.
2. **OPUS-MT fallback** for misses — a Marian model run via a **CTranslate2
   Python sidecar** (int8-quantized, CPU-friendly) called over HTTP from NestJS.
   OPUS-MT is **CC-BY** (commercial-OK); avoid NLLB (CC-BY-NC).
3. **Cache** the `(lemma, sense, targetLanguage) → translation` result in the
   translation table. Vocabulary is finite, so warm-cache hit rate approaches
   100% and the sidecar is rarely called.

> **Sentence translation is out of scope for quick-create.** Dictionary lookup
> does **not** work on sentences; that would be pure MT (OPUS-MT sidecar or a
> cloud API) and is a separate feature. See [Out of scope](#out-of-scope).

### CEFR — frequency mapping

Derive `cefrLevel` from the `frequency_rank` already on the entity
([vocabulary.entity.ts](../../src/vocabularies/entities/vocabulary.entity.ts)),
mapped through CEFR frequency bands (English Vocabulary Profile / CEFR-J where
available). Deterministic, instant, no model. Field stays **editable** so a
curator can override.

### POS / definition / IPA — dictionary, extended

Already non-Gemma for `en`
([dictionary-client.ts](../../src/vocabularies/enrichment/dictionary-client.ts)).
The work here is **coverage**:

- Multilingual entries via a self-hosted **Wiktionary (wiktextract)** dataset so
  the from-scratch path stops needing Gemma for non-English words.
- IPA: keep dictionary-composed IPA; add **`espeak-ng` (G2P)** as a rule-based
  last resort instead of Gemma's best-effort IPA.

### gloss / image — optional, editable

Neither blocks creation. `gloss` defaults to the leading 1–4 words of the
definition (extractive, no model). `image` is fetched on demand from an external
image API or left empty. Both are user-editable.

### audio — unchanged

Already generated asynchronously via the audio queue; no Gemma involvement.

## The hard part: non-English / total dictionary miss

The from-scratch path is what Gemma currently rescues. Replacement strategy, in
order:

1. **Wiktionary (multilingual)** covers most non-English lemmas → treat like the
   dictionary path.
2. **Partial assembly:** fill whatever is available (POS/definition from
   Wiktionary, examples from corpus, IPA from G2P, translation from lookup);
   leave the rest blank and editable.
3. **Last-resort Gemma fallback (flagged, default off):** only when *everything*
   misses and the operator has opted in. This is the single remaining Gemma call
   and can be removed entirely once coverage is proven.

## Component changes

- **[enrichment.processor.ts](../../src/vocabularies/enrichment/enrichment.processor.ts)** —
  rework `generateDrafts` / `draftsFromDictionary` / `draftsFromScratch` to pull
  examples from the retrieval service, translation from the lookup+MT service,
  CEFR from the frequency mapper; drop the Gemma batchers from the default path.
- **New `ExampleRetrievalService`** — corpus index + GDEX filter.
- **New `TranslationService`** — lookup → OPUS-MT sidecar → cache.
- **New `CefrEstimatorService`** — frequency → CEFR band.
- **[dictionary-client.ts](../../src/vocabularies/enrichment/dictionary-client.ts)** —
  add a multilingual (Wiktionary) provider behind the existing interface.
- **[gemma-enricher.ts](../../src/vocabularies/enrichment/gemma-enricher.ts) /
  [gemma-batcher.ts](../../src/vocabularies/enrichment/gemma-batcher.ts)** — keep,
  but only reachable via the last-resort flag; delete once retired.
- **Data attribution:** the `source` tag on persisted senses/translations moves
  from `'gemma'` to `'corpus'` (examples) and `'dictionary'` / `'opus-mt'`
  (translations). New OPUS-MT sidecar deployment (Python/CTranslate2 + FastAPI).

## Production-readiness concerns

- **Caching is the load-bearing optimization.** Every field here is
  deterministic per input, so the existing
  [enrichment-cache.service.ts](../../src/vocabularies/enrichment/enrichment-cache.service.ts)
  keeps working; translation gets its own per-`(lemma,sense,lang)` cache.
- **Graceful degradation:** any single source missing → that field is left
  empty and editable, never a hard failure. Only a *total* miss marks the job
  failed (same as today).
- **OPUS-MT ops:** new sidecar to deploy/monitor/scale; per-language-pair models
  cost storage/memory; mitigate with quantization + the translation cache so it
  is called only on the long tail.
- **Licensing:** PanLex (CC0) cleanest; Wiktionary (CC-BY-SA) carries
  share-alike/attribution; OPUS-MT (CC-BY); Tatoeba (CC-BY). Record attribution.
- **Monitoring:** log per-field miss rates (especially examples + translation)
  so coverage gaps and the need for the Gemma fallback are measurable.
- **No new external runtime dependency on the hot path:** lookups + retrieval +
  CEFR all live in Postgres; the only out-of-process call is the OPUS-MT sidecar,
  and only on a translation cache miss.

## Rollout

Phased, behind the `enrichment.useGemmaFallback` config flag, keeping Gemma
retirable rather than ripped out. All phases are now implemented:

1. ✅ **Non-generative fields first** — CEFR (`cefr_lexicon`), examples
   (`corpus_sentence` retrieval), translation (`bilingual_lexicon` + OPUS-MT).
2. ✅ **Multilingual dictionary** (`dictionary_entry`/Wiktionary) routes
   non-English + dictionary-miss words through the dictionary path; the
   dictionary path itself is Gemma-optional (extractive gloss, nullable CEFR).
3. ✅ **The flag** gates every Gemma call (the dictionary batch and the scratch
   path). **The default stays `true`** so a fresh deploy still falls back to
   Gemma — flipping to Gemma-free is an **ops action**, not a code default:
   set `ENRICHMENT_USE_GEMMA_FALLBACK=false` **after** loading the data
   (`cefr_lexicon`, `corpus_sentence`, `bilingual_lexicon`, `dictionary_entry`),
   or the missed fields come back empty/editable. Per-word coverage is logged
   (corpus/lexicon hit counts) so the fallback reliance is measurable first.
4. ⏳ **Remove Gemma** (enricher, batcher) — deferred until production metrics
   show the fallback is effectively never hit. Note `gemma.config.ts` is shared
   with practice scoring, so it stays regardless.

## Evaluation / success criteria

- **Coverage:** % of quick-creates with each field populated, vs. the Gemma
  baseline. Target: ≥ baseline for POS/definition/IPA/translation/CEFR.
- **Example quality:** human rating on naturalness + correct-sense for a sample;
  automatic proxies (length, grammaticality, contains-target).
- **Translation accuracy:** spot-check against a reference set per language pair.
- **Latency / cost:** end-to-end job time and external-call count per word
  (should trend to ~0 calls once cached).
- **Gemma-fallback hit rate** → must approach 0 before removing Gemma.

## Out of scope

- **Sentence translation** (free-form or translating example sentences) — pure
  MT, no dictionary; separate feature. If added, pre-translate the bounded
  example bank with OPUS-MT/cloud API and cache; do not translate arbitrary user
  text on the quick-create path.
- Training any model from scratch (translation or examples) — explicitly
  rejected in favor of off-the-shelf models + corpora.

## Open questions

- **Dictionary provider for multilingual:** self-host Wiktionary (free, you run
  it, CC-BY-SA) vs. a commercial API (quality, cost, English-centric)?
- **Example corpus scope:** Tatoeba only (cleaner, thinner) vs. + OpenSubtitles
  (wider, noisier)?
- **CEFR source:** EVP/CEFR-J wordlists vs. pure frequency bins?
- **TTS:** keep current provider, or move to a self-hosted (Piper/Coqui) engine
  to match the "no external dependence" goal?
- **Image:** which provider, and is it worth wiring at all for v1?
