# OPUS-MT translation sidecar

Self-hosted neural MT for the enrichment pipeline — replaces the paid Google
Translate dependency. FastAPI in front of [CTranslate2](https://github.com/OpenNMT/CTranslate2)
running [Helsinki-NLP](https://github.com/Helsinki-NLP/Opus-MT) Marian models
(CC-BY 4.0). Consumed by the NestJS worker's `TranslationService`
([../../src/vocabularies/enrichment/sources/translation.service.ts](../../src/vocabularies/enrichment/sources/translation.service.ts)).

## Contract

```
POST /translate
  { "source": "en", "target": "vi", "texts": ["study", "She studies medicine."] }
->{ "translations": ["học", "Cô ấy học y khoa."] }     # array aligned to texts; null per item that can't be translated

GET /health -> { "status": "ok" }
```

- When `OPUS_MT_TOKEN` is set, every request must send `Authorization: Bearer <token>` (else 401).
- `source == target`, empty `texts`, or an unsupported language pair → all-`null` translations (200, never an error).

## Supported pairs

`en→vi` only for now. To add a pair: in the [Dockerfile](Dockerfile)'s builder
stage, convert `Helsinki-NLP/opus-mt-<src>-<tgt>` into `/models/<src>-<tgt>/ct2`
and save its tokenizer into `/models/<src>-<tgt>/tokenizer` (copy the two
existing lines). [app.py](app.py) auto-detects any pair present on disk — no code
change needed. The request already carries `source`/`target`.

## Run locally

```bash
docker build -t opus-mt services/opus-mt        # converts the model into the image (first build is slow)
docker run --rm -p 8001:8001 opus-mt

curl -s -XPOST localhost:8001/translate \
  -H 'content-type: application/json' \
  -d '{"source":"en","target":"vi","texts":["study","She studies medicine."]}'
```

Then point the backend at it: `OPUS_MT_SERVICE_URL=http://localhost:8001` in the
repo's `.env` and run the worker (`node dist/worker.js`).

## Deploy (Railway)

Deployed as its own always-on service in the same Railway project, reached over
the private network — see [../../docs/deployment/railway_deploy.md](../../docs/deployment/railway_deploy.md).

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8001` | HTTP port (Railway injects it). |
| `OPUS_MT_TOKEN` | `` (open) | Shared Bearer token; must match the backend's `OPUS_MT_TOKEN`. |
| `OPUS_MT_MODELS_DIR` | `/models` | Where converted models live. |
| `OPUS_MT_DEVICE` | `cpu` | CTranslate2 device (`cpu`/`cuda`). |
