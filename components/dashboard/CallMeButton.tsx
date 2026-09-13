"use client";

import { useState } from "react";
import { Phone, PhoneCall, Loader2, PhoneOff } from "lucide-react";
import type { AnalyzedSubscription } from "@/lib/dashboard-types";

type Step = "idle" | "asking" | "calling" | "done" | "error";

function summarize(subscriptions: AnalyzedSubscription[]): string {
  const needsYou = subscriptions.filter((s) => s.status === "ask" || s.status === "hold");
  if (needsYou.length === 0) {
    return "Nothing needs a decision right now — just checking in.";
  }
  return needsYou.map((s) => `${s.name}: ${s.reason}`).join(" ");
}

export default function CallMeButton({
  mode,
  subscriptions,
  phoneNumber,
  onPhoneChange,
}: {
  mode: "demo" | "real";
  subscriptions: AnalyzedSubscription[];
  phoneNumber: string;
  onPhoneChange: (v: string) => void;
}) {
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);

  async function placeCall() {
    setStep("calling");
    setError(null);
    try {
      const res = await fetch("/api/dashboard/call-me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber, context: summarize(subscriptions) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Couldn't place the call");
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("error");
    } finally {
      setTimeout(() => setStep("idle"), 3200);
    }
  }

  function onClick() {
    if (step !== "idle") return;
    if (mode === "demo") {
      // Nothing real to call — same "sounds like the real thing" stub as
      // the rest of /demo, so the button still shows what it does.
      setStep("calling");
      setTimeout(() => setStep("done"), 1400);
      setTimeout(() => setStep("idle"), 4200);
      return;
    }
    if (!phoneNumber) {
      setStep("asking");
      return;
    }
    placeCall();
  }

  const label = { idle: "Call me", asking: "Call me", calling: "Calling…", done: "Calling you now", error: "Try again" }[step];
  const Icon = step === "calling" ? Loader2 : step === "done" ? PhoneCall : step === "error" ? PhoneOff : Phone;

  return (
    <div className="call-me-wrap">
      <button className={`call-me-btn ${step === "calling" ? "calling" : ""} ${step === "done" ? "done" : ""}`} onClick={onClick} disabled={step === "calling"}>
        <span className="call-me-ic">
          <Icon size={14} className={step === "calling" ? "spin" : ""} />
        </span>
        {label}
      </button>

      {step === "asking" && (
        <div className="call-me-panel">
          <input
            type="tel"
            placeholder="+1 555 555 5555"
            value={phoneNumber}
            autoFocus
            onChange={(e) => onPhoneChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && phoneNumber && placeCall()}
          />
          <div className="call-me-panel-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setStep("idle")}>
              Cancel
            </button>
            <button className="btn btn-renew btn-sm" disabled={!phoneNumber} onClick={placeCall}>
              Call now
            </button>
          </div>
          <p className="call-me-hint">Vouch reads out what needs your decision, out loud.</p>
        </div>
      )}

      {step === "error" && error && <p className="call-me-error">{error}</p>}
    </div>
  );
}
