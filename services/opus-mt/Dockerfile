# OPUS-MT translation sidecar: FastAPI + CTranslate2 serving Helsinki-NLP Marian
# models. Multi-stage: the builder converts the model (needs Torch); the runtime
# ships only the converted model + tokenizer and the serving deps (no Torch).
#
# clear_execstack.py strips the executable-stack flag CTranslate2's wheel sets on
# its native lib, which some kernels (Docker Desktop / WSL2) refuse to load. It
# runs in BOTH stages because each pip-installs its own copy of ctranslate2.

# ---- builder: convert model + bake tokenizer (Torch only lives here) ----
FROM python:3.11-slim AS builder
ENV PIP_NO_CACHE_DIR=1 HF_HOME=/tmp/hf
WORKDIR /build
COPY requirements.txt .
# CPU-only Torch (avoids pulling CUDA), plus the runtime deps the converter uses.
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY clear_execstack.py .
RUN python clear_execstack.py /usr/local/lib/python3.11/site-packages
# Convert en->vi to CTranslate2 (int8) and save its tokenizer alongside. Add more
# pairs by repeating both lines with another Helsinki-NLP/opus-mt-<src>-<tgt>.
RUN ct2-transformers-converter \
      --model Helsinki-NLP/opus-mt-en-vi \
      --quantization int8 \
      --output_dir /models/en-vi/ct2 \
 && python -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('Helsinki-NLP/opus-mt-en-vi').save_pretrained('/models/en-vi/tokenizer')"

# ---- runtime: serving only, no Torch ----
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OPUS_MT_MODELS_DIR=/models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY clear_execstack.py .
RUN python clear_execstack.py /usr/local/lib/python3.11/site-packages
COPY --from=builder /models /models
COPY app.py .

# Railway injects $PORT; default 8001 for local `docker run`. Bind IPv6 (`::`) so
# the service is reachable over Railway's private network (IPv6) AND IPv4.
ENV PORT=8001
EXPOSE 8001
CMD ["sh", "-c", "uvicorn app:app --host :: --port ${PORT:-8001}"]
