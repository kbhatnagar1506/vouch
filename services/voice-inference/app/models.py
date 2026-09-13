"""Model loading for the voice-verification service.

Speaker verification uses SpeechBrain's ECAPA-TDNN checkpoint pretrained on
VoxCeleb (speechbrain/spkrec-ecapa-voxceleb) as a frozen embedding
extractor — enrollment just stores the embedding of a reference clip, and
verification compares a new clip's embedding to it by cosine similarity.
That doesn't require training anything or holding a VoxCeleb license
ourselves: the published checkpoint already generalizes to unseen speakers.

Fine-tuning this backbone further (e.g. on Vouch's own enrolled users) is a
separate, later project gated on GPU compute and is not what this service
does today.

Anti-spoofing (AASIST, pretrained on ASVspoof2019 LA) is NOT bundled here —
the checkpoint isn't included in this repo and no download URL is wired
in. `SpoofDetector` is written as a pluggable interface so a real
checkpoint can be dropped in later (see docs/VOICE.md "Anti-spoofing").
Until then it reports `model_loaded: False` rather than fabricating a
score, and callers should not treat that as "not spoofed" — see the
enroll/verify routes' handling of `model_loaded`.
"""

import os
import threading
from typing import Optional

import torch

MODEL_VERSION = "speechbrain/spkrec-ecapa-voxceleb"

_speaker_model = None
_speaker_model_lock = threading.Lock()


def is_speaker_model_loaded() -> bool:
    return _speaker_model is not None


def get_speaker_model():
    global _speaker_model
    if _speaker_model is None:
        with _speaker_model_lock:
            if _speaker_model is None:
                # Imported lazily: this pulls in speechbrain + torch model
                # loading, which is slow and unnecessary for /health.
                from speechbrain.inference.speaker import EncoderClassifier

                _speaker_model = EncoderClassifier.from_hparams(
                    source=MODEL_VERSION,
                    savedir=os.environ.get("SPEECHBRAIN_CACHE_DIR", "/tmp/speechbrain/ecapa"),
                )
    return _speaker_model


def embed(waveform: torch.Tensor) -> list[float]:
    model = get_speaker_model()
    with torch.no_grad():
        embedding = model.encode_batch(waveform)
    return embedding.squeeze().tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    ta, tb = torch.tensor(a), torch.tensor(b)
    return torch.nn.functional.cosine_similarity(ta.unsqueeze(0), tb.unsqueeze(0)).item()


class SpoofDetector:
    """Pluggable anti-spoofing interface. See module docstring."""

    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()
        self.checkpoint_path: Optional[str] = os.environ.get("AASIST_CHECKPOINT_PATH")

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None or not self.checkpoint_path:
            return
        with self._lock:
            if self._model is not None:
                return
            if not os.path.exists(self.checkpoint_path):
                return
            # A real AASIST checkpoint's architecture must be defined and
            # imported here to load state_dict correctly — deliberately
            # not stubbed out with a fake architecture, since a wrong
            # spoof score is worse than an honest "not available".
            raise NotImplementedError(
                "AASIST_CHECKPOINT_PATH is set but no model architecture is wired up "
                "in services/voice-inference/app/models.py. See docs/VOICE.md "
                "'Anti-spoofing' for how to integrate a real checkpoint."
            )

    def score(self, waveform: torch.Tensor) -> Optional[float]:
        self.load()
        if self._model is None:
            return None
        with torch.no_grad():
            return float(self._model(waveform))


spoof_detector = SpoofDetector()
