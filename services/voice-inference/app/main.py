import json
import os

from fastapi import Depends, FastAPI, HTTPException, UploadFile, Form
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import models
from .audio import decode_to_waveform, duration_seconds

app = FastAPI(title="vouch-voice-inference")
bearer_scheme = HTTPBearer()

DEFAULT_MATCH_THRESHOLD = 0.75


def require_api_key(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> None:
    expected = os.environ.get("VOICE_SERVICE_API_KEY")
    if not expected:
        raise HTTPException(status_code=500, detail="VOICE_SERVICE_API_KEY is not set on the server")
    if credentials.credentials != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/embed", dependencies=[Depends(require_api_key)])
async def embed(audio: UploadFile):
    waveform = decode_to_waveform(await audio.read())
    embedding = models.embed(waveform)
    return {
        "embedding": embedding,
        "model_version": models.MODEL_VERSION,
        "duration_seconds": duration_seconds(waveform),
    }


@app.post("/verify", dependencies=[Depends(require_api_key)])
async def verify(audio: UploadFile, reference_embedding: str = Form(...)):
    reference = json.loads(reference_embedding)
    waveform = decode_to_waveform(await audio.read())
    embedding = models.embed(waveform)
    score = models.cosine_similarity(embedding, reference)
    threshold = float(os.environ.get("VOICE_MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD))
    return {"score": score, "match": score >= threshold, "threshold": threshold}


@app.post("/spoof-check", dependencies=[Depends(require_api_key)])
async def spoof_check(audio: UploadFile):
    waveform = decode_to_waveform(await audio.read())
    score = models.spoof_detector.score(waveform)
    if score is None:
        return {"spoof_score": None, "is_spoof": False, "model_loaded": False}
    threshold = float(os.environ.get("SPOOF_THRESHOLD", 0.5))
    return {"spoof_score": score, "is_spoof": score >= threshold, "model_loaded": True}
