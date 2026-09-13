"use client";

import { useEffect, useState } from "react";
import Script from "next/script";
import Image from "next/image";
import PersonaWidget from "@/components/PersonaWidget";

// Pinned exactly. Persona publishes no unversioned alias (persona-v5.js
// 404s), and pinning is what stops a vendor-side release from changing the
// behaviour of a page that can authorize spending.
const PERSONA_SDK_URL = "https://cdn.withpersona.com/dist/persona-v5.8.0.js";

const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL;

export default function VerifyPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setEmail(data.user?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  useEffect(() => {
    if (!done || !DASHBOARD_URL) return;
    const timer = setTimeout(() => {
      window.location.href = DASHBOARD_URL;
    }, 1600);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <>
      <Script src={PERSONA_SDK_URL} strategy="afterInteractive" />
      <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
        <div className="w-full max-w-[440px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
          {email && <div className="mb-3 flex justify-end text-[13px] text-slate-500">{email}</div>}

          <div className="mb-7 flex justify-center">
            <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-14 w-auto object-contain" priority />
          </div>

          <h1 className="mb-2 text-center text-2xl font-bold tracking-tight text-slate-900">
            Before Vouch spends your money
          </h1>
          {/* Saying plainly what this unlocks, rather than "verify your
              identity to continue". The ask lands at the moment the agent is
              about to act, so the reason for it is concrete and immediate —
              that's what makes it feel reasonable rather than like a toll. */}
          <p className="mb-7 text-center text-sm leading-relaxed text-slate-500">
            Vouch is about to mint a card and make calls on your behalf. A quick ID check is what lets us be sure
            it&apos;s really you — and it&apos;s what makes the voice on those calls mean something.
          </p>

          <PersonaWidget onVerified={() => setDone(true)} />

          <ul className="mt-7 space-y-2 text-[13px] leading-relaxed text-slate-500">
            <li>· Takes about a minute — a photo ID and a selfie.</li>
            <li>· We store your name and address, and whether you&apos;re over 18. Not your date of birth, ID number, or photos.</li>
            <li>· You can keep browsing your dashboard without this. It only gates spending.</li>
          </ul>

          {done && DASHBOARD_URL && (
            <p className="mt-6 text-center text-sm text-slate-500">Taking you back to your dashboard…</p>
          )}
        </div>
      </div>
    </>
  );
}
