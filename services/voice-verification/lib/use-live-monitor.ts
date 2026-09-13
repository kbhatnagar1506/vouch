"use client";

import { useCallback, useRef, useState } from "react";

export type LiveStatus = "idle" | "listening" | "match" | "mismatch" | "error";

// ECAPA-TDNN needs a few seconds of clean speech to embed reliably —
// sub-2s clips are a known hard case for speaker verification (higher
// EER), and each chunk also pays an opus-encoder warm-up cost at the
// start of a fresh MediaRecorder instance, which eats further into an
// already-short window. 2.2s was producing wildly unreliable scores
// (18% same-speaker similarity) in real testing; 4.5s trades reaction
// time for accuracy.
const CHUNK_MS = 4500;
// Below this peak amplitude a chunk is treated as silence and skipped —
// without this, a silent window would still get sent to /verify and could
// flip to a spurious mismatch instead of just holding the last real state.
const SILENCE_PEAK_THRESHOLD = 0.06;

// Raw cosine-similarity scores from a single 4.5s window against one
// enrollment embedding are noisier than they look — real testing showed
// the same speaker scoring anywhere from 0.09 to 0.61 across consecutive
// windows in one session (this checkpoint isn't fine-tuned or
// score-normalized). Averaging the last few scores before comparing to
// the threshold smooths that out far better than reacting to each raw
// window individually.
const SCORE_HISTORY_SIZE = 3;

/**
 * Continuously samples the mic in short windows and calls `verify` on any
 * window that actually contains speech (cheap client-side amplitude gate,
 * not real VAD, but enough to ignore silence). Status is driven by a
 * rolling average of the last few speaker-match scores, not any single
 * window, and holds through silence in between.
 */
export function useLiveMonitor(verify: (blob: Blob) => Promise<{ score: number; threshold: number } | null>) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const scoreHistoryRef = useRef<number[]>([]);

  const recordWindow = useCallback((stream: MediaStream): Promise<{ blob: Blob | null; peak: number }> => {
    return new Promise((resolve) => {
      const analyser = analyserRef.current;
      const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
      let peak = 0;
      let raf: number;

      const sample = () => {
        if (analyser && data) {
          analyser.getByteTimeDomainData(data);
          for (let i = 0; i < data.length; i++) {
            const centered = Math.abs((data[i] - 128) / 128);
            if (centered > peak) peak = centered;
          }
        }
        raf = requestAnimationFrame(sample);
      };
      raf = requestAnimationFrame(sample);

      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        cancelAnimationFrame(raf);
        resolve({ blob: chunks.length ? new Blob(chunks, { type: "audio/webm" }) : null, peak });
      };
      recorder.start();
      setTimeout(() => recorder.stop(), CHUNK_MS);
    });
  }, []);

  const loop = useCallback(
    async (stream: MediaStream) => {
      scoreHistoryRef.current = [];

      while (activeRef.current) {
        const { blob, peak } = await recordWindow(stream);
        if (!activeRef.current) break;

        if (!blob || peak < SILENCE_PEAK_THRESHOLD) {
          // Silence — hold whatever status we already had.
          continue;
        }

        try {
          const result = await verify(blob);
          if (!activeRef.current) break;
          if (result === null) {
            // The amplitude gate passed but Silero VAD found no actual
            // speech (e.g. a thump, breath, background noise) — hold
            // status rather than treating it as a real data point.
            continue;
          }

          const history = scoreHistoryRef.current;
          history.push(result.score);
          if (history.length > SCORE_HISTORY_SIZE) history.shift();

          if (result.score >= result.threshold) {
            // Quick to reassure: one clear match clears an alarm
            // immediately, rather than waiting for a rolling average to
            // recover from a single bad window still sitting in it.
            setStatus("match");
          } else {
            // Slow to alarm: only flag "mismatch" once the recent
            // average — not just one noisy window — is actually low.
            const average = history.reduce((a, b) => a + b, 0) / history.length;
            setStatus(average >= result.threshold ? "match" : "mismatch");
          }
        } catch {
          if (!activeRef.current) break;
          setStatus("error");
        }
      }
    },
    [recordWindow, verify],
  );

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      activeRef.current = true;
      setStatus("listening");
      loop(stream);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, [loop]);

  const stop = useCallback(() => {
    activeRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    analyserRef.current = null;
    scoreHistoryRef.current = [];
    setStatus("idle");
  }, []);

  return { status, error, start, stop };
}
