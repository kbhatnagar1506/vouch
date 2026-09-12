"""Decodes an uploaded audio file (webm/opus from the browser, or wav/mp3)
into a mono 16kHz float32 waveform tensor, which is what both the speaker
embedding model and the anti-spoofing model expect.
"""

import io

import torch
from pydub import AudioSegment

TARGET_SAMPLE_RATE = 16_000


def decode_to_waveform(raw_bytes: bytes) -> torch.Tensor:
    # pydub (via ffmpeg) handles whatever container the browser's
    # MediaRecorder produced (webm/opus, ogg, etc.) — torchaudio alone
    # doesn't reliably decode webm without an ffmpeg-backed build.
    segment = AudioSegment.from_file(io.BytesIO(raw_bytes))
    segment = segment.set_channels(1).set_frame_rate(TARGET_SAMPLE_RATE)

    samples = torch.tensor(segment.get_array_of_samples(), dtype=torch.float32)
    samples /= 1 << (8 * segment.sample_width - 1)  # normalize int PCM to [-1, 1]
    return samples.unsqueeze(0)  # shape: (1, num_samples)


def duration_seconds(waveform: torch.Tensor) -> float:
    return waveform.shape[-1] / TARGET_SAMPLE_RATE
