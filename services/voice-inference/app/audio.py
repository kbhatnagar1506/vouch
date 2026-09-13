"""Decodes an uploaded audio file (webm/opus from the browser, or wav/mp3)
into a mono 16kHz float32 waveform tensor, which is what both the speaker
embedding model and the anti-spoofing model expect.
"""

import io
import logging

import torch
from pydub import AudioSegment

TARGET_SAMPLE_RATE = 16_000
logger = logging.getLogger("uvicorn.error")


def decode_to_waveform(raw_bytes: bytes) -> torch.Tensor:
    # pydub (via ffmpeg) handles whatever container the browser's
    # MediaRecorder produced (webm/opus, ogg, etc.) — torchaudio alone
    # doesn't reliably decode webm without an ffmpeg-backed build.
    segment = AudioSegment.from_file(io.BytesIO(raw_bytes))
    original_sample_width = segment.sample_width
    original_frame_rate = segment.frame_rate
    original_channels = segment.channels
    segment = segment.set_channels(1).set_frame_rate(TARGET_SAMPLE_RATE)

    samples = torch.tensor(segment.get_array_of_samples(), dtype=torch.float32)
    samples /= 1 << (8 * segment.sample_width - 1)  # normalize int PCM to [-1, 1]
    waveform = samples.unsqueeze(0)  # shape: (1, num_samples)

    # Diagnostic: real browser MediaRecorder webm/opus chunks were producing
    # wildly unstable same-speaker verification scores (-0.015 to 0.55 in
    # one continuous session) — logging decode characteristics to find out
    # whether some chunks are decoding to garbage (wrong sample width,
    # near-silent, clipped) rather than assuming it's a model/threshold
    # problem.
    if waveform.numel() > 0:
        logger.info(
            "decode_to_waveform: raw_bytes=%d input(width=%d,rate=%d,ch=%d) "
            "output(samples=%d,dur=%.2fs,min=%.4f,max=%.4f,mean=%.5f,std=%.4f)",
            len(raw_bytes),
            original_sample_width,
            original_frame_rate,
            original_channels,
            waveform.numel(),
            waveform.numel() / TARGET_SAMPLE_RATE,
            waveform.min().item(),
            waveform.max().item(),
            waveform.mean().item(),
            waveform.std().item(),
        )
    else:
        logger.warning("decode_to_waveform: produced an EMPTY waveform from %d raw bytes", len(raw_bytes))

    return waveform


def duration_seconds(waveform: torch.Tensor) -> float:
    return waveform.shape[-1] / TARGET_SAMPLE_RATE
