"""Voice-activity detection via Silero VAD.

Replaces the crude "was the peak amplitude loud enough" client-side gate
with an actual speech-detection model server-side: real testing showed
same-speaker verification scores swinging wildly (0.09-0.61 across
consecutive windows in one session) partly because windows could contain
mostly non-speech (breath, background noise, silence padding) alongside a
little actual speech, diluting the embedding. Trimming to just the
detected speech segments before embedding should improve signal quality
going into both the speaker and anti-spoofing models.

silero-vad ships its model weights inside the pip package itself (no
network fetch at runtime, no HF-style rate-limit risk — see docs/VOICE.md
for how that bit us with the speaker model).
"""

import threading
from typing import Optional

import torch
from silero_vad import collect_chunks, get_speech_timestamps, load_silero_vad

SAMPLE_RATE = 16_000

_model = None
_lock = threading.Lock()


def is_vad_loaded() -> bool:
    return _model is not None


def get_vad_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                _model = load_silero_vad()
    return _model


def trim_to_speech(waveform: torch.Tensor) -> Optional[torch.Tensor]:
    """Returns the concatenated speech-only portion of a mono waveform
    (shape (1, N)), or None if no speech was detected at all."""
    model = get_vad_model()
    audio_1d = waveform.squeeze(0)
    timestamps = get_speech_timestamps(audio_1d, model, sampling_rate=SAMPLE_RATE)
    if not timestamps:
        return None
    speech = collect_chunks(timestamps, audio_1d)
    return speech.unsqueeze(0)
