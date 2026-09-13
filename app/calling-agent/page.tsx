"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";

interface CallRecord {
  id: string;
  vapiCallId: string | null;
  toNumber: string;
  purpose: string;
  status: string;
  endedReason: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  structuredData: Record<string, unknown> | null;
  humanDetection: { isHuman: boolean | null; confidence: number | null; source: string; reason?: string } | null;
  createdAt: string;
}

const ACTIVE_STATUSES = new Set(["queued", "scheduled", "ringing", "in-progress", "forwarding"]);

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-amber-50 text-amber-700",
  scheduled: "bg-amber-50 text-amber-700",
  ringing: "bg-blue-50 text-blue-700",
  "in-progress": "bg-blue-50 text-blue-700",
  forwarding: "bg-blue-50 text-blue-700",
  ended: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  "not-found": "bg-red-50 text-red-700",
};

function StatusPill({ status }: { status: string }) {
  const isActive = ACTIVE_STATUSES.has(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"}`}
    >
      {isActive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {status}
    </span>
  );
}

export default function CallingAgentPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [toNumber, setToNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadCalls = useCallback(async () => {
    const res = await fetch("/api/calling-agent/calls");
    const data = await res.json();
    if (res.ok) setCalls(data.calls);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setEmail(data.user?.email ?? null));
    loadCalls();
  }, [loadCalls]);

  // Live-ish updates: poll while any call is still in flight, stop otherwise.
  useEffect(() => {
    const hasActive = calls.some((c) => ACTIVE_STATUSES.has(c.status));
    if (hasActive && !pollRef.current) {
      pollRef.current = setInterval(loadCalls, 4000);
    } else if (!hasActive && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [calls, loadCalls]);

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login";
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/calling-agent/calls", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber: toNumber || undefined, purpose: purpose || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to start call");
      setToNumber("");
      setPurpose("");
      await loadCalls();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="mx-auto max-w-[640px]">
        <div className="mb-6 flex items-center justify-between">
          <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-9 w-auto object-contain" priority />
          {email && (
            <div className="flex items-center gap-3 text-[13px] text-slate-500">
              <span>{email}</span>
              <button onClick={onLogout} className="font-semibold text-blue-600 hover:brightness-110">
                Log out
              </button>
            </div>
          )}
        </div>

        <div className="rounded-[20px] border border-slate-100 bg-white p-7 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
          <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">Calling agent</h1>
          <p className="mb-6 text-sm text-slate-500">
            Place an outbound call — a Vapi + ElevenLabs + Gemini voice agent calls on Vouch&apos;s behalf to collect or confirm
            onboarding details, then reports back here.
          </p>

          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="tel"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
              placeholder="Phone number (defaults to your profile's)"
              className="w-full rounded-[10px] border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Purpose (defaults to onboarding_profile)"
              className="w-full rounded-[10px] border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-[10px] bg-blue-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Starting call…" : "Call now"}
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <h2 className="mt-8 mb-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Recent calls</h2>
          {calls.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No calls yet.</p>}
          <div className="space-y-2">
            {calls.map((call) => {
              const expanded = expandedId === call.id;
              return (
                <div key={call.id} className="rounded-xl bg-slate-50 p-4 text-sm">
                  <button
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => setExpandedId(expanded ? null : call.id)}
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{call.toNumber}</div>
                      <div className="text-slate-500">
                        {call.purpose} · {new Date(call.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <StatusPill status={call.status} />
                  </button>

                  {expanded && (
                    <div className="mt-3 space-y-3 border-t border-slate-200 pt-3">
                      {call.humanDetection && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Human detection</div>
                          <p className="text-slate-700">
                            {call.humanDetection.isHuman == null
                              ? "Not evaluated yet (no model attached)."
                              : call.humanDetection.isHuman
                                ? "Likely a live person."
                                : "Likely voicemail / not a live person."}
                            <span className="text-slate-400"> — {call.humanDetection.source}</span>
                          </p>
                        </div>
                      )}
                      {call.structuredData && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Collected info</div>
                          <dl className="mt-1 grid grid-cols-2 gap-1">
                            {Object.entries(call.structuredData).map(([key, value]) => (
                              <div key={key} className="contents">
                                <dt className="text-slate-500">{key}</dt>
                                <dd className="text-slate-900">{String(value)}</dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                      {call.transcript && (
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Transcript</div>
                          <p className="mt-1 whitespace-pre-wrap text-slate-700">{call.transcript}</p>
                        </div>
                      )}
                      {call.recordingUrl && (
                        <audio controls src={call.recordingUrl} className="w-full">
                          <track kind="captions" />
                        </audio>
                      )}
                      {call.endedReason && <p className="text-xs text-slate-400">Ended: {call.endedReason}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
