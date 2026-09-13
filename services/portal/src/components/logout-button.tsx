"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="w-full rounded-[10px] border-[1.5px] border-slate-200 bg-white py-3 text-[15px] font-bold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
    >
      {loading ? "Logging out…" : "Log Out"}
    </button>
  );
}
