"use client";

import { useCallback, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "stopped";

/** Records a short clip from the browser mic as a single Blob (webm/opus). */
export function useVoiceRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const start = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        setState("stopped");
        const blob = chunksRef.current.length ? new Blob(chunksRef.current, { type: "audio/webm" }) : null;
        resolve(blob);
      };
      recorder.stop();
    });
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    chunksRef.current = [];
  }, []);

  return { state, error, start, stop, reset };
}
