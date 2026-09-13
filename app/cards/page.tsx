"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CardManager } from "@/components/card-manager";

// This page doubles as the Stripe step of onboarding (login -> Gmail ->
// bank -> here -> voice -> dashboard), so it needs somewhere to go next.
// Every step in the chain is skippable: nothing here is required to reach
// the dashboard, and a card can be minted later from the dashboard itself.
const VOICE_REGISTER_URL =
  process.env.NEXT_PUBLIC_VOICE_REGISTER_URL ?? "https://voice.getvouch.club/voice/register";

export default function CardsPage() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setEmail(data.user?.email ?? null));
  }, []);

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login";
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[560px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
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

        <CardManager />

        <Link
          href={VOICE_REGISTER_URL}
          className="mt-6 block w-full rounded-xl bg-blue-600 px-5 py-3.5 text-center text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Continue
        </Link>
        <Link
          href={VOICE_REGISTER_URL}
          className="mt-3 block text-center text-[13px] font-semibold text-slate-400 transition hover:text-slate-600"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}
