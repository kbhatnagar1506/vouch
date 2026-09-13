import json
import os

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile, Form

from . import models, vad
from .audio import decode_to_waveform, duration_seconds

app = FastAPI(title="vouch-voice-inference")

# 0.75 (the original guess) rejected real same-speaker verifications in
# testing at 66.9% cosine similarity — this checkpoint's raw, unnormalized
# similarity scores run lower than that intuition suggests. 0.5 is a
# provisional, better-fit default; still not calibrated against real
# negative (different-speaker) trials — see docs/VOICE.md.
DEFAULT_MATCH_THRESHOLD = 0.5

# Cloud Run's own IAM invoker check already authenticates the caller (only
# the voice-inference-caller service account can reach this service at
# all — see docs/VOICE.md) and does so via the `Authorization` header, so
# this app-level check uses a separate header to avoid colliding with it.
# It's defense-in-depth against IAM misconfiguration, not the only guard.
def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("VOICE_SERVICE_API_KEY")
    if not expected:
        raise HTTPException(status_code=500, detail="VOICE_SERVICE_API_KEY is not set on the server")
    if x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.on_event("startup")
def preload_models() -> None:
    # Loads all models into memory once at process start, rather than
    # lazily on the first request — combined with a Cloud Run startup
    # probe against /health (see docs/VOICE.md), this keeps a freshly
    # started instance out of traffic rotation until it's actually ready,
    # so no real request ever pays the model-load cost.
    models.get_speaker_model()
    models.spoof_detector.load()
    vad.get_vad_model()


@app.get("/health")
def health():
    if not models.is_speaker_model_loaded():
        raise HTTPException(status_code=503, detail="Speaker model still loading")
    return {"ok": True}


async def _decode_and_trim(audio: UploadFile):
    """Decodes the upload and trims it to just the detected speech, via
    Silero VAD — a real speech-activity model instead of the crude
    peak-amplitude gate the client used to rely on alone. Raises a 422 if
    no speech was detected at all, rather than silently embedding
    silence/noise (which is what was producing unstable scores)."""
    waveform = decode_to_waveform(await audio.read())
    trimmed = vad.trim_to_speech(waveform)
    if trimmed is None:
        raise HTTPException(status_code=422, detail="no_speech_detected")
    return trimmed


@app.post("/embed", dependencies=[Depends(require_api_key)])
async def embed(audio: UploadFile):
    waveform = await _decode_and_trim(audio)
    embedding = models.embed(waveform)
    return {
        "embedding": embedding,
        "model_version": models.MODEL_VERSION,
        "duration_seconds": duration_seconds(waveform),
    }


@app.post("/verify", dependencies=[Depends(require_api_key)])
async def verify(audio: UploadFile, reference_embedding: str = Form(...)):
    reference = json.loads(reference_embedding)
    waveform = await _decode_and_trim(audio)
    embedding = models.embed(waveform)
    score = models.cosine_similarity(embedding, reference)
    threshold = float(os.environ.get("VOICE_MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD))
    return {"score": score, "match": score >= threshold, "threshold": threshold}


@app.post("/spoof-check", dependencies=[Depends(require_api_key)])
async def spoof_check(audio: UploadFile):
    waveform = await _decode_and_trim(audio)
    score = models.spoof_detector.score(waveform)
    if score is None:
        return {"spoof_score": None, "is_spoof": False, "model_loaded": False}
    threshold = float(os.environ.get("SPOOF_THRESHOLD", 0.5))
    return {"spoof_score": score, "is_spoof": score >= threshold, "model_loaded": True}
