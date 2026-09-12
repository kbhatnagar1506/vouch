FROM python:3.11-slim

# ffmpeg: needed by pydub to decode the webm/opus clips the browser's
# MediaRecorder produces.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Cloud Run sets $PORT; default to 8080 for local runs.
ENV PORT=8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
