"use client";

import { useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";
import { useLiveMonitor, type LiveStatus } from "@/lib/use-live-monitor";

type Mode = "enroll" | "monitor";

interface Status {
  enrolled: boolean;
  enrolledAt: string | null;
}

interface VerifyResult {
  passed: boolean;
  speaker: { score: number; threshold: number; match: boolean };
  spoof: { score: number | null; is_spoof: boolean; model_loaded: boolean };
}

const ENROLL_PROMPT = "My voice is my password. Vouch will always verify it's really me.";

function MicIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 19v3" />
      <path d="M8 22h8" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function XIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function WarningIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

function RecordButton({
  recording,
  busy,
  disabled,
  level,
  onClick,
}: {
  recording: boolean;
  busy: boolean;
  disabled?: boolean;
  level: number;
  onClick: () => void;
}) {
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      {recording && (
        <>
          <span
            className="absolute rounded-full bg-red-500/25"
            style={{
              width: `${100 + level * 90}px`,
              height: `${100 + level * 90}px`,
              transition: "width 80ms linear, height 80ms linear",
            }}
          />
          <span
            className="absolute rounded-full bg-red-500/20"
            style={{
              width: `${128 + level * 130}px`,
              height: `${128 + level * 130}px`,
              transition: "width 120ms linear, height 120ms linear",
            }}
          />
        </>
      )}
      <button
        onClick={onClick}
        disabled={disabled || busy}
        aria-label={recording ? "Stop recording" : "Start recording"}
        className={`relative z-10 flex h-24 w-24 items-center justify-center rounded-full text-white shadow-[0_8px_24px_rgba(37,99,235,0.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
          recording ? "bg-red-600 shadow-[0_8px_24px_rgba(220,38,38,0.35)]" : "bg-blue-600"
        }`}
      >
        {busy ? (
          <svg className="animate-spin" width="26" height="26" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : recording ? (
          <StopIcon />
        ) : (
          <MicIcon />
        )}
      </button>
    </div>
  );
}

const STATUS_STYLES: Record<LiveStatus, { ring: string; badge: string; label: string }> = {
  idle: { ring: "bg-slate-100", badge: "bg-slate-300", label: "Not monitoring" },
  listening: { ring: "bg-emerald-100", badge: "bg-emerald-500", label: "Listening — sounds like you" },
  match: { ring: "bg-emerald-100", badge: "bg-emerald-500", label: "Verified — it's you" },
  mismatch: { ring: "bg-red-100", badge: "bg-red-600", label: "Different voice detected" },
  error: { ring: "bg-amber-100", badge: "bg-amber-500", label: "Check failed — retrying" },
};

function LiveStatusRing({ status }: { status: LiveStatus }) {
  const style = STATUS_STYLES[status];
  const isAlert = status === "mismatch";
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      {(status === "listening" || status === "match") && (
        <span className="absolute h-32 w-32 animate-ping rounded-full bg-emerald-400/30" />
      )}
      {isAlert && <span className="absolute h-32 w-32 animate-ping rounded-full bg-red-500/40" />}
      <div className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white transition-colors duration-200 ${style.badge}`}>
        {status === "mismatch" ? <XIcon size={34} /> : status === "error" ? <WarningIcon size={34} /> : <CheckIcon size={34} />}
      </div>
    </div>
  );
}

export default function VoicePage() {
  const [mode, setMode] = useState<Mode>("enroll");
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<VerifyResult | null>(null);

  const recorder = useVoiceRecorder();

  const verifyChunk = useCallback(async (blob: Blob): Promise<{ score: number; threshold: number }> => {
    const form = new FormData();
    form.set("audio", blob, "chunk.webm");
    const res = await fetch("/api/voice/verify", { method: "POST", body: form });
    const data: VerifyResult = await res.json();
    if (!res.ok) throw new Error((data as unknown as { error?: string }).error ?? "Verification failed");
    setLastResult(data);
    return { score: data.speaker.score, threshold: data.speaker.threshold };
  }, []);

  const monitor = useLiveMonitor(verifyChunk);

  const loadStatus = () => {
    fetch("/api/voice/status")
      .then((res) => res.json())
      .then((data) => setStatus(data));
  };

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setEmail(data.user?.email ?? null));
    loadStatus();
  }, []);

  useEffect(() => {
    // Stop monitoring if the visitor navigates away from this tab.
    return () => monitor.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLogout = async () => {
    monitor.stop();
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login";
  };

  const switchMode = (next: Mode) => {
    if (next !== mode) monitor.stop();
    setMode(next);
    setError(null);
    setMessage(null);
    setLastResult(null);
  };

  const submitEnroll = async (blob: Blob) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("audio", blob, "enroll.webm");
      const res = await fetch("/api/voice/enroll", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrollment failed");
      setMessage("Voice enrolled. Switch to Live Monitor to try it out.");
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const onRecordClick = async () => {
    if (recorder.state === "recording") {
      const blob = await recorder.stop();
      recorder.reset();
      if (blob) await submitEnroll(blob);
    } else {
      setError(null);
      setMessage(null);
      await recorder.start();
    }
  };

  const disabledMonitor = !status?.enrolled;
  const isMismatch = monitor.status === "mismatch";

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      {isMismatch && (
        <div
          className="pointer-events-none fixed inset-0 z-50 animate-pulse"
          style={{ boxShadow: "inset 0 0 0 8px rgba(220,38,38,0.9), inset 0 0 80px 20px rgba(220,38,38,0.45)" }}
        />
      )}

      <div className="w-full max-w-[440px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        {email && (
          <div className="mb-3 flex justify-end gap-3 text-[13px] text-slate-500">
            <span>{email}</span>
            <button onClick={onLogout} className="font-semibold text-blue-600 hover:brightness-110">
              Log out
            </button>
          </div>
        )}

        <div className="mb-7 flex justify-center">
          <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-14 w-auto object-contain" priority />
        </div>

        <div className="relative mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => switchMode("enroll")}
            className={`relative z-10 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              mode === "enroll" ? "text-white" : "text-slate-500"
            }`}
          >
            Enroll
          </button>
          <button
            type="button"
            onClick={() => switchMode("monitor")}
            className={`relative z-10 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              mode === "monitor" ? "text-white" : "text-slate-500"
            }`}
          >
            Live Monitor
          </button>
          <span
            className={`absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-lg bg-blue-600 transition-transform duration-250 ease-out ${
              mode === "enroll" ? "translate-x-0" : "translate-x-full"
            }`}
          />
        </div>

        {mode === "enroll" ? (
          <>
            <h1 className="mb-1.5 text-center text-2xl font-bold tracking-tight text-slate-900">Enroll your voice</h1>
            <p className="mb-7 text-center text-sm text-slate-500">
              {status?.enrolled ? "Record again any time to re-enroll." : "Record a short sample once, and Vouch remembers your voice."}
            </p>

            <p className="mb-6 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">
              Read this out loud, clearly: <br />
              <span className="font-semibold text-slate-800">&ldquo;{ENROLL_PROMPT}&rdquo;</span>
            </p>

            <div className="flex flex-col items-center gap-3 py-2">
              <RecordButton recording={recorder.state === "recording"} busy={busy} level={recorder.level} onClick={onRecordClick} />
              <p className="text-[13px] font-medium text-slate-400">
                {recorder.state === "recording" ? "Recording — tap to stop" : busy ? "Processing…" : "Tap to record"}
              </p>
            </div>

            {recorder.error && <p className="mt-3 text-center text-sm text-red-600">{recorder.error}</p>}
            {message && <p className="mt-4 text-center text-sm text-emerald-600">{message}</p>}
            {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
          </>
        ) : (
          <>
            <h1 className="mb-1.5 text-center text-2xl font-bold tracking-tight text-slate-900">Live voice monitor</h1>
            <p className="mb-7 text-center text-sm text-slate-500">
              {disabledMonitor
                ? "Enroll your voice first before monitoring."
                : "Keeps listening and flags the moment a different voice takes over."}
            </p>

            <div className="flex flex-col items-center gap-3 py-2">
              <LiveStatusRing status={monitor.status} />
              <p
                className={`text-[13px] font-semibold ${
                  monitor.status === "mismatch" ? "text-red-600" : monitor.status === "error" ? "text-amber-600" : "text-slate-500"
                }`}
              >
                {STATUS_STYLES[monitor.status].label}
              </p>
            </div>

            <button
              onClick={() => (monitor.status === "idle" ? monitor.start() : monitor.stop())}
              disabled={disabledMonitor}
              className={`mt-5 w-full rounded-[10px] py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                monitor.status === "idle" ? "bg-blue-600" : "bg-slate-700"
              }`}
            >
              {monitor.status === "idle" ? "Start monitoring" : "Stop monitoring"}
            </button>

            {monitor.error && <p className="mt-3 text-center text-sm text-red-600">{monitor.error}</p>}

            {lastResult && (
              <p className="mt-4 text-center text-[12px] text-slate-400">
                Last check: speaker match {(lastResult.speaker.score * 100).toFixed(1)}%
                {lastResult.spoof.model_loaded && `, liveness ${lastResult.spoof.is_spoof ? "failed" : "ok"}`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
