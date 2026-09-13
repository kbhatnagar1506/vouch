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

Anti-spoofing uses AASIST (vendored from https://github.com/clovaai/aasist,
MIT license — see app/aasist_model.py and THIRD_PARTY_LICENSES/), a graph
attention network pretrained on ASVspoof2019 LA to distinguish bonafide
human speech from synthetic/converted/replayed audio. Also a frozen
pretrained checkpoint, not fine-tuned — same rationale as the speaker
model. If `app/weights/aasist.pth` is ever missing (e.g. a stripped-down
build), `SpoofDetector` reports `model_loaded: False` rather than
fabricating a score, and callers should not treat that as "not spoofed" —
see the enroll/verify routes' handling of `model_loaded`.
"""

import os
import threading
from typing import Optional

import torch

AASIST_MODEL_CONFIG = {
    "architecture": "AASIST",
    "nb_samp": 64600,  # ~4.04s at 16kHz — the reference repo's fixed eval input length
    "first_conv": 128,
    "filts": [70, [1, 32], [32, 32], [32, 64], [64, 64]],
    "gat_dims": [64, 32],
    "pool_ratios": [0.5, 0.7, 0.5, 0.5],
    "temperatures": [2.0, 2.0, 100.0, 100.0],
}

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


def _pad_or_tile(waveform_1d: torch.Tensor, target_len: int) -> torch.Tensor:
    """Matches the vendored repo's eval-time data_utils.pad(): tile-repeat
    a short clip and truncate a long one, deterministically (not a random
    crop) so the same clip always scores the same."""
    length = waveform_1d.shape[0]
    if length >= target_len:
        return waveform_1d[:target_len]
    repeats = target_len // length + 1
    return waveform_1d.repeat(repeats)[:target_len]


class SpoofDetector:
    """AASIST anti-spoofing check. See module docstring."""

    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()
        self.checkpoint_path: str = os.environ.get(
            "AASIST_CHECKPOINT_PATH",
            os.path.join(os.path.dirname(__file__), "weights", "aasist.pth"),
        )

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self) -> None:
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            if not os.path.exists(self.checkpoint_path):
                return
            from .aasist_model import Model as AasistModel

            model = AasistModel(AASIST_MODEL_CONFIG)
            state_dict = torch.load(self.checkpoint_path, map_location="cpu")
            model.load_state_dict(state_dict)
            model.eval()
            self._model = model

    def score(self, waveform: torch.Tensor) -> Optional[float]:
        """Spoof probability in [0, 1] — higher means more likely
        synthetic/converted/replayed. None if the model isn't available."""
        self.load()
        if self._model is None:
            return None
        padded = _pad_or_tile(waveform.squeeze(0), AASIST_MODEL_CONFIG["nb_samp"]).unsqueeze(0)
        with torch.no_grad():
            _, logits = self._model(padded)
            # Index 1 = bonafide (see the vendored repo's data_utils.py:
            # training label 1 == "bonafide") — spoof probability is the
            # complementary softmax mass, index 0.
            spoof_prob = torch.softmax(logits, dim=1)[:, 0]
        return float(spoof_prob.item())


spoof_detector = SpoofDetector()
