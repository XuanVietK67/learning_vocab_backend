"""
OPUS-MT translation sidecar (FastAPI + CTranslate2).

Serves the self-hosted Marian models behind a tiny HTTP contract consumed by the
NestJS worker's TranslationService:

    POST /translate  { "source": "en", "target": "vi", "texts": ["..."] }
                  -> { "translations": ["...", null, ...] }   # aligned to texts
    GET  /health     -> { "status": "ok" }

Design notes:
  - Models are CTranslate2-converted at image build time (see Dockerfile) into
    /models/<source>-<target>, loaded lazily and cached per language pair.
  - An unknown/unsupported pair returns all-null translations (200), not an
    error, so the client doesn't pointlessly retry a permanent miss.
  - When OPUS_MT_TOKEN is set, every request must carry `Authorization: Bearer
    <token>` (mirrors the pronunciation-scoring service). Empty = open.
  - The endpoint never raises on a per-item tokenize/decode issue; that item is
    returned as null. Translation must never fail enrichment downstream.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import List, Optional

import ctranslate2
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoTokenizer

MODELS_DIR = os.environ.get("OPUS_MT_MODELS_DIR", "/models")
AUTH_TOKEN = os.environ.get("OPUS_MT_TOKEN", "")
DEVICE = os.environ.get("OPUS_MT_DEVICE", "cpu")
# Each supported pair lives in /models/<source>-<target>/ with two subdirs baked
# at image build time (see Dockerfile): `ct2/` (CTranslate2 weights) and
# `tokenizer/` (the Marian/SentencePiece tokenizer). Both are loaded offline.

app = FastAPI(title="opus-mt", version="1.0.0")


class TranslateRequest(BaseModel):
    source: str = Field(min_length=2, max_length=8)
    target: str = Field(min_length=2, max_length=8)
    texts: List[str]


class TranslateResponse(BaseModel):
    translations: List[Optional[str]]


@lru_cache(maxsize=8)
def _load_pair(pair: str):
    """Load (translator, tokenizer) for `<source>-<target>`, cached. Returns
    None when the pair isn't baked into this image."""
    model_path = os.path.join(MODELS_DIR, pair, "ct2")
    tok_path = os.path.join(MODELS_DIR, pair, "tokenizer")
    if not os.path.isdir(model_path) or not os.path.isdir(tok_path):
        return None
    translator = ctranslate2.Translator(model_path, device=DEVICE)
    tokenizer = AutoTokenizer.from_pretrained(tok_path)
    return translator, tokenizer


def _translate_batch(pair: str, texts: List[str]) -> List[Optional[str]]:
    loaded = _load_pair(pair)
    if loaded is None:
        return [None] * len(texts)
    translator, tokenizer = loaded

    # Only translate non-empty texts; keep a mapping back to original positions.
    idxs = [i for i, t in enumerate(texts) if t and t.strip()]
    out: List[Optional[str]] = [None] * len(texts)
    if not idxs:
        return out

    try:
        source_tokens = [
            tokenizer.convert_ids_to_tokens(tokenizer.encode(texts[i]))
            for i in idxs
        ]
        results = translator.translate_batch(source_tokens)
        for pos, res in zip(idxs, results):
            tokens = res.hypotheses[0]
            text = tokenizer.decode(
                tokenizer.convert_tokens_to_ids(tokens),
                skip_special_tokens=True,
            ).strip()
            out[pos] = text or None
    except Exception:  # noqa: BLE001 - never fail the whole batch on one decode
        return [None] * len(texts)
    return out


def _check_auth(authorization: Optional[str]) -> None:
    if not AUTH_TOKEN:
        return
    expected = f"Bearer {AUTH_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="invalid or missing token")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/translate", response_model=TranslateResponse)
def translate(
    body: TranslateRequest,
    authorization: Optional[str] = Header(default=None),
):
    _check_auth(authorization)
    if body.source == body.target or not body.texts:
        return {"translations": [None] * len(body.texts)}
    pair = f"{body.source}-{body.target}"
    return {"translations": _translate_batch(pair, body.texts)}
