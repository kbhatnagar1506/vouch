"use client";

import { useState } from "react";
import Sidebar from "./Sidebar";
import Overview from "./Overview";
import Cards from "./Cards";
import Budget from "./Budget";
import Analysis from "./Analysis";
import Transactions from "./Transactions";
import Connectors from "./Connectors";
import Settings from "./Settings";
import CardPopup from "./CardPopup";
import type { AnalyzedSubscription, Budget as BudgetData, Connector, DashboardUser, Transaction } from "@/lib/dashboard-types";

export type PageId = "overview" | "cards" | "budget" | "analysis" | "transactions" | "connectors" | "settings";

interface ResolveResponse {
  error?: string;
  phoneRequired?: boolean;
  subscription?: Partial<AnalyzedSubscription>;
}

export default function DashboardShell({
  mode,
  initialSubscriptions,
  transactions,
  budget,
  connectors,
  user,
}: {
  mode: "demo" | "real";
  initialSubscriptions: AnalyzedSubscription[];
  transactions: Transaction[];
  budget: BudgetData;
  connectors: Connector[];
  user: DashboardUser;
}) {
  const [page, setPage] = useState<PageId>("overview");
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);
  const [openSubId, setOpenSubId] = useState<string | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ action: "renew" | "cancel"; name: string } | null>(null);

  const openSub = subscriptions.find((s) => s.id === openSubId) ?? null;

  function openPopup(s: AnalyzedSubscription) {
    setOpenSubId(s.id);
    setNeedsPhone(false);
    setResolveError(null);
  }

  function closePopup() {
    setOpenSubId(null);
    setNeedsPhone(false);
    setResolveError(null);
  }

  function celebrate(action: "renew" | "cancel", name: string) {
    setSuccess({ action, name });
    setTimeout(() => {
      setSuccess(null);
      closePopup();
    }, 1300);
  }

  async function resolve(id: string, action: "renew" | "cancel") {
    const sub = subscriptions.find((s) => s.id === id);
    if (!sub) return;

    if (mode === "demo") {
      // Mirrors vouch-ui's original stub — these are seeded subscriptions,
      // nothing real to mint or cancel — but still worth celebrating so the
      // demo shows the same moment the real flow does.
      celebrate(action, sub.name);
      return;
    }

    setResolving(true);
    setResolveError(null);
    try {
      const res = await fetch("/api/dashboard/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptionId: id,
          action,
          merchant: sub.name,
          priceCents: Math.round(sub.price * 100),
          phoneNumber: phoneNumber || undefined,
        }),
      });
      const data: ResolveResponse = await res.json();
      if (!res.ok) {
        if (data.phoneRequired) {
          setNeedsPhone(true);
          return;
        }
        throw new Error(data.error || "Something went wrong");
      }
      if (data.subscription) {
        const patch = data.subscription;
        setSubscriptions((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
      }
      celebrate(action, sub.name);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : String(err));
    } finally {
      setResolving(false);
    }
  }

  async function onLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL || "https://login.getvouch.club/login";
  }

  return (
    <div className="app">
      <Sidebar
        page={page}
        setPage={setPage}
        onOpen={openPopup}
        subscriptions={subscriptions}
        user={user}
        onLogout={mode === "real" ? onLogout : undefined}
        mode={mode}
        phoneNumber={phoneNumber}
        onPhoneChange={setPhoneNumber}
      />
      <main className="main">
        <div key={page} className="page-transition">
          {page === "overview" && <Overview subscriptions={subscriptions} budget={budget} onOpen={openPopup} />}
          {page === "cards" && <Cards subscriptions={subscriptions} onOpen={openPopup} />}
          {page === "budget" && <Budget budget={budget} mode={mode} />}
          {page === "analysis" && <Analysis subscriptions={subscriptions} mode={mode} />}
          {page === "transactions" && <Transactions transactions={transactions} mode={mode} />}
          {page === "connectors" && <Connectors connectors={connectors} />}
          {page === "settings" && <Settings user={user} mode={mode} />}
        </div>
      </main>

      <CardPopup
        sub={openSub}
        onClose={closePopup}
        onResolve={resolve}
        mode={mode}
        needsPhone={needsPhone}
        phoneNumber={phoneNumber}
        onPhoneChange={setPhoneNumber}
        resolving={resolving}
        resolveError={resolveError}
        success={success}
      />
    </div>
  );
}
