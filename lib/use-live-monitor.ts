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

/**
 * Continuously samples the mic in short windows and calls `verify` on any
 * window that actually contains speech (cheap client-side amplitude gate,
 * not real VAD, but enough to ignore silence). Status flips to "match"/
 * "mismatch" based on the result of each spoken chunk and holds through
 * silence in between.
 */
export function useLiveMonitor(verify: (blob: Blob) => Promise<boolean>) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

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
      // Quick to reassure (flip green on the first match), slower to
      // alarm (two mismatches in a row) — a single noisy window
      // shouldn't trigger a false "different voice" alert on its own.
      let consecutiveMismatches = 0;

      while (activeRef.current) {
        const { blob, peak } = await recordWindow(stream);
        if (!activeRef.current) break;

        if (!blob || peak < SILENCE_PEAK_THRESHOLD) {
          // Silence — hold whatever status we already had.
          continue;
        }

        try {
          const match = await verify(blob);
          if (!activeRef.current) break;
          if (match) {
            consecutiveMismatches = 0;
            setStatus("match");
          } else {
            consecutiveMismatches += 1;
            if (consecutiveMismatches >= 2) setStatus("mismatch");
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
    setStatus("idle");
  }, []);

  return { status, error, start, stop };
}
