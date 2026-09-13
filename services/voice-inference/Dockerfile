FROM python:3.11-slim

# ffmpeg: needed by pydub to decode the webm/opus clips the browser's
# MediaRecorder produces.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Bake the pretrained ECAPA-TDNN weights into the image at build time —
# Cloud Run containers are ephemeral, so without this every cold start
# re-downloads the model from Hugging Face Hub, which is slow and, under
# repeated deploys/cold starts, gets the shared Cloud Run egress IP
# rate-limited (429) by HF's anonymous-download quota.
ENV SPEECHBRAIN_CACHE_DIR=/app/pretrained_models/ecapa
RUN python -c "from app.models import get_speaker_model; get_speaker_model()"
# No network access to HF needed at runtime now that the weights are
# baked in above — also means the service still starts if HF is down.
ENV HF_HUB_OFFLINE=1

# Cloud Run sets $PORT; default to 8080 for local runs.
ENV PORT=8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
