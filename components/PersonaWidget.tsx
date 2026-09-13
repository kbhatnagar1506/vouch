"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Persona's embedded flow, rather than their hosted redirect. The challenge
// framing is "make one people don't mind going through" — the embedded
// widget keeps the user inside Vouch (our page, our copy, our framing of
// *why* we're asking) instead of bouncing them to a withpersona.com URL and
// back. The inquiry itself is still created server-side; this only opens it.
type Step = "idle" | "loading" | "open" | "checking" | "verified" | "failed" | "error";

interface PersonaClient {
  open: () => void;
  destroy?: () => void;
}

interface PersonaConstructorOptions {
  inquiryId: string;
  sessionToken?: string | null;
  environmentId?: string | null;
  onReady: () => void;
  onComplete: (payload: { inquiryId: string; status: string }) => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
}

declare global {
  interface Window {
    Persona?: { Client: new (options: PersonaConstructorOptions) => PersonaClient };
  }
}

export default function PersonaWidget({ onVerified }: { onVerified?: () => void }) {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<PersonaClient | null>(null);

  useEffect(() => {
    return () => clientRef.current?.destroy?.();
  }, []);

  /**
   * Persona's own `status` in onComplete is client-side and therefore not
   * trustworthy, and it reports `completed` (reached the last screen) rather
   * than `approved` (checks actually passed). So we ignore it and ask our
   * own server, which reconciles against Persona's API.
   */
  const confirmWithServer = useCallback(async () => {
    setStep("checking");
    // The approval decision runs server-side at Persona and arrives by
    // webhook, so it may not be ready the instant the widget closes. Poll
    // briefly rather than showing a wrong answer.
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const res = await fetch("/api/identity/status");
        const data = await res.json();
        if (data.verified) {
          setStep("verified");
          onVerified?.();
          return;
        }
        if (data.status === "declined" || data.status === "failed" || data.status === "expired") {
          setStep("failed");
          return;
        }
      } catch {
        // Keep polling — a transient network blip shouldn't end the flow.
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    // Still pending: needs_review, or the webhook hasn't landed. Not a
    // failure — say so honestly instead of implying rejection.
    setStep("checking");
    setError("Still reviewing. This can take a moment — we'll email you when it's done.");
  }, [onVerified]);

  const start = useCallback(async () => {
    setError(null);
    setStep("loading");
    try {
      const res = await fetch("/api/identity/inquiry", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start verification");

      if (data.alreadyVerified) {
        setStep("verified");
        onVerified?.();
        return;
      }

      if (!window.Persona) throw new Error("Verification didn't load. Check your connection and try again.");

      const client = new window.Persona.Client({
        inquiryId: data.inquiryId,
        sessionToken: data.sessionToken,
        environmentId: data.environmentId,
        onReady: () => {
          setStep("open");
          client.open();
        },
        onComplete: () => void confirmWithServer(),
        onCancel: () => setStep("idle"),
        onError: (err: unknown) => {
          setStep("error");
          setError(err instanceof Error ? err.message : "Verification failed to load");
        },
      });
      clientRef.current = client;
    } catch (err) {
      setStep("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [confirmWithServer, onVerified]);

  if (step === "verified") {
    return (
      <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5 text-center">
        <p className="text-sm font-semibold text-emerald-800">You&apos;re verified</p>
        <p className="mt-1 text-sm text-emerald-700">Vouch can now mint cards and make calls on your behalf.</p>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={start}
        disabled={step === "loading" || step === "open" || step === "checking"}
        className="w-full rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
      >
        {step === "loading" && "Starting…"}
        {step === "open" && "Verification open…"}
        {step === "checking" && "Confirming…"}
        {(step === "idle" || step === "error" || step === "failed") && "Verify my identity"}
      </button>

      {step === "failed" && (
        <p className="mt-3 text-center text-sm text-rose-600">
          We couldn&apos;t verify that. You can try again with a different document.
        </p>
      )}
      {error && <p className="mt-3 text-center text-sm text-slate-500">{error}</p>}
    </div>
  );
}
