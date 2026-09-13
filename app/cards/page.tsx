"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { CardManager } from "@/components/card-manager";

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
      </div>
    </div>
  );
}
