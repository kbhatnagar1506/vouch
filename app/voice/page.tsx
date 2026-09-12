"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useVoiceRecorder } from "@/lib/use-voice-recorder";

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

export default function VoicePage() {
  const [email, setEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const enrollRecorder = useVoiceRecorder();
  const verifyRecorder = useVoiceRecorder();

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

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login";
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
      setMessage("Voice enrolled. You can now verify with it.");
      loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async (blob: Blob) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set("audio", blob, "verify.webm");
      const res = await fetch("/api/voice/verify", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[520px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
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

        <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">Voice verification</h1>
        <p className="mb-6 text-sm text-slate-500">
          {status?.enrolled
            ? "Your voice is enrolled. Verify a call sample below."
            : "Record a short sample once to enroll your voice."}
        </p>

        <div className="rounded-xl bg-slate-50 p-4">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
            {status?.enrolled ? "Re-enroll" : "Enroll"}
          </h2>
          <p className="mb-3 text-sm text-slate-600">
            Read this out loud, clearly, for about 5 seconds: <span className="font-medium text-slate-800">&ldquo;{ENROLL_PROMPT}&rdquo;</span>
          </p>
          {enrollRecorder.state !== "recording" ? (
            <button
              onClick={() => enrollRecorder.start()}
              disabled={busy}
              className="w-full rounded-[10px] bg-blue-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start recording
            </button>
          ) : (
            <button
              onClick={async () => {
                const blob = await enrollRecorder.stop();
                enrollRecorder.reset();
                if (blob) await submitEnroll(blob);
              }}
              className="w-full animate-pulse rounded-[10px] bg-red-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110"
            >
              Stop &amp; enroll
            </button>
          )}
          {enrollRecorder.error && <p className="mt-2 text-sm text-red-600">{enrollRecorder.error}</p>}
        </div>

        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Verify</h2>
          <p className="mb-3 text-sm text-slate-600">Record a fresh sample to check it against your enrollment.</p>
          {verifyRecorder.state !== "recording" ? (
            <button
              onClick={() => verifyRecorder.start()}
              disabled={busy || !status?.enrolled}
              className="w-full rounded-[10px] bg-blue-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start recording
            </button>
          ) : (
            <button
              onClick={async () => {
                const blob = await verifyRecorder.stop();
                verifyRecorder.reset();
                if (blob) await submitVerify(blob);
              }}
              className="w-full animate-pulse rounded-[10px] bg-red-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110"
            >
              Stop &amp; verify
            </button>
          )}
          {verifyRecorder.error && <p className="mt-2 text-sm text-red-600">{verifyRecorder.error}</p>}
        </div>

        {message && <p className="mt-4 text-sm text-emerald-600">{message}</p>}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        {result && (
          <div className={`mt-4 rounded-xl p-4 text-sm ${result.passed ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            <p className="font-semibold">{result.passed ? "Verified" : "Not verified"}</p>
            <p className="mt-1 text-slate-600">
              Speaker match score {result.speaker.score.toFixed(3)} (threshold {result.speaker.threshold.toFixed(3)})
            </p>
            <p className="text-slate-600">
              {result.spoof.model_loaded
                ? `Spoof score ${result.spoof.score?.toFixed(3)} — ${result.spoof.is_spoof ? "flagged as synthetic/replayed" : "looks live"}`
                : "Anti-spoofing model not deployed yet — spoof check skipped"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
