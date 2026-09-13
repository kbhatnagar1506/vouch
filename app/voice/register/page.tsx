"use client";

// Enrollment-only step for the onboarding chain (signup/login -> Gmail ->
// bank -> here). Deliberately a separate page from /voice, which stays
// as the full Enroll + Live Monitor demo experience, untouched.

import { useEffect, useState } from "react";
import Image from "next/image";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";

const ENROLL_PROMPT = "My voice is my password. Vouch will always verify it's really me.";
const ENROLL_SAMPLES = 3;
// Where the onboarding chain ends: the real dashboard. Unset (e.g. local
// dev without it running) just leaves the success screen up instead of
// redirecting, so enrollment still completes cleanly on its own.
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL;
// Long enough to read "You're all set" before the page changes under you —
// enrollment is the last step, so the confirmation is worth a beat rather
// than a jump the user never sees.
const REDIRECT_DELAY_MS = 1400;

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

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function RecordButton({
  recording,
  busy,
  level,
  onClick,
}: {
  recording: boolean;
  busy: boolean;
  level: number;
  onClick: () => void;
}) {
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      {recording && (
        <>
          <span
            className="absolute rounded-full bg-red-500/25"
            style={{ width: `${100 + level * 90}px`, height: `${100 + level * 90}px`, transition: "width 80ms linear, height 80ms linear" }}
          />
          <span
            className="absolute rounded-full bg-red-500/20"
            style={{ width: `${128 + level * 130}px`, height: `${128 + level * 130}px`, transition: "width 120ms linear, height 120ms linear" }}
          />
        </>
      )}
      <button
        onClick={onClick}
        disabled={busy}
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

export default function VoiceRegisterPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [enrollBlobs, setEnrollBlobs] = useState<Blob[]>([]);

  const recorder = useVoiceRecorder();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    if (!done || !DASHBOARD_URL) return;
    const timer = setTimeout(() => {
      window.location.href = DASHBOARD_URL;
    }, REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const submitEnroll = async (blobs: Blob[]) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      blobs.forEach((blob, i) => form.append("audio", blob, `enroll-${i}.webm`));
      const res = await fetch("/api/voice/enroll", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Enrollment failed");
      setDone(true);
      setEnrollBlobs([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setEnrollBlobs([]);
    } finally {
      setBusy(false);
    }
  };

  const onRecordClick = async () => {
    if (recorder.state === "recording") {
      const blob = await recorder.stop();
      recorder.reset();
      if (!blob) return;
      const nextBlobs = [...enrollBlobs, blob];
      if (nextBlobs.length >= ENROLL_SAMPLES) {
        await submitEnroll(nextBlobs);
      } else {
        setEnrollBlobs(nextBlobs);
      }
    } else {
      setError(null);
      await recorder.start();
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[440px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        {email && <div className="mb-3 flex justify-end text-[13px] text-slate-500">{email}</div>}

        <div className="mb-7 flex justify-center">
          <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-14 w-auto object-contain" priority />
        </div>

        {done ? (
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckIcon />
            </div>
            <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">You&apos;re all set</h1>
            <p className="text-sm text-slate-500">
              {DASHBOARD_URL ? "Your voice is registered. Taking you to your dashboard…" : "Your voice is registered. Setup is complete."}
            </p>
            {DASHBOARD_URL && (
              // Manual way through if the redirect is blocked (pop-up/nav
              // blockers) — the last onboarding step shouldn't dead-end.
              <a href={DASHBOARD_URL} className="mt-4 inline-block text-sm font-semibold text-blue-600 hover:text-blue-700">
                Go to dashboard
              </a>
            )}
          </div>
        ) : (
          <>
            <h1 className="mb-1.5 text-center text-2xl font-bold tracking-tight text-slate-900">Register your voice</h1>
            <p className="mb-7 text-center text-sm text-slate-500">
              Last step — record 3 short clips so Vouch can recognize your voice.
            </p>

            <div className="mb-6 flex justify-center gap-2">
              {Array.from({ length: ENROLL_SAMPLES }).map((_, i) => (
                <span key={i} className={`h-2 w-2 rounded-full ${i < enrollBlobs.length ? "bg-blue-600" : "bg-slate-200"}`} />
              ))}
            </div>

            <p className="mb-6 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">
              Read this out loud, clearly: <br />
              <span className="font-semibold text-slate-800">&ldquo;{ENROLL_PROMPT}&rdquo;</span>
            </p>

            <div className="flex flex-col items-center gap-3 py-2">
              <RecordButton recording={recorder.state === "recording"} busy={busy} level={recorder.level} onClick={onRecordClick} />
              <p className="text-[13px] font-medium text-slate-400">
                {recorder.state === "recording"
                  ? "Recording — tap to stop"
                  : busy
                    ? "Processing…"
                    : `Tap to record ${enrollBlobs.length + 1} of ${ENROLL_SAMPLES}`}
              </p>
            </div>

            {recorder.error && <p className="mt-3 text-center text-sm text-red-600">{recorder.error}</p>}
            {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}

            {/* Every other onboarding step is skippable; this one was the
                exception, which left a user without a working mic stuck on
                the last step with no way to reach their dashboard. Voice
                can be enrolled later from the dashboard. */}
            {DASHBOARD_URL && (
              <a
                href={DASHBOARD_URL}
                className="mt-6 block text-center text-[13px] font-semibold text-slate-400 transition hover:text-slate-600"
              >
                Skip for now
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
