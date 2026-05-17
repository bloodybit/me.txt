FROM python:3.11-slim

WORKDIR /app

# Build deps for Pillow on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libjpeg62-turbo zlib1g \
    && rm -rf /var/lib/apt/lists/*

COPY apps/worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/worker /app

# Default to the fake embedder for fast local boot. Set EMBEDDING_MODEL=siglip2
# and pip install -r requirements-ml.txt to enable real SigLIP2.
ENV PYTHONUNBUFFERED=1 \
    EMBEDDING_MODEL=fake-deterministic \
    EMBEDDING_DIM=768

CMD ["python", "main.py"]
