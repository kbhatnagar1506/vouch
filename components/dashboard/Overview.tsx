import { Wallet, ShieldCheck, PiggyBank, Clock } from "lucide-react";
import SubList from "./SubList";
import type { AnalyzedSubscription, Budget } from "@/lib/dashboard-types";

export default function Overview({
  subscriptions,
  budget,
  onOpen,
}: {
  subscriptions: AnalyzedSubscription[];
  budget: Budget;
  onOpen: (s: AnalyzedSubscription) => void;
}) {
  const monthly = subscriptions.reduce((s, x) => s + (x.status !== "cancel" ? x.price : 0), 0);
  const active = subscriptions.filter((s) => s.card !== "closed").length;
  const needsYou = subscriptions.filter((s) => s.status === "ask" || s.status === "hold");

  const stats = [
    {
      icon: Wallet,
      label: "Monthly commit",
      value: `$${monthly.toFixed(2)}`,
      hint: `${subscriptions.length} subscription${subscriptions.length === 1 ? "" : "s"} tracked`,
      accent: "linear-gradient(120deg,#1f3df0,#4f6bff)",
      solid: "#1f3df0",
    },
    {
      icon: ShieldCheck,
      label: "Active cards",
      value: active,
      hint: `${subscriptions.length - active} closed & waiting`,
      accent: "linear-gradient(120deg,#0d0d0f,#3a3a42)",
      solid: "#0d0d0f",
    },
    {
      icon: PiggyBank,
      label: "Saved this month",
      value: `$${budget.saved.toFixed(2)}`,
      hint: "not currently committed to a charge",
      accent: "linear-gradient(120deg,#0b8a5a,#14b877)",
      solid: "#0b8a5a",
    },
    {
      icon: Clock,
      label: "Needs you",
      value: needsYou.length,
      hint: "decisions waiting on your call",
      accent: "linear-gradient(120deg,#c47d18,#e0a020)",
      solid: "#c47d18",
    },
  ];

  return (
    <>
      <div className="page-head">
        <div className="page-title">Overview</div>
        <div className="page-sub">Every subscription has to re-earn its charge. Here&rsquo;s where things stand.</div>
      </div>

      <div className="stat-grid">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div className="stat" key={s.label} style={{ ["--accent" as string]: s.accent }}>
              <div className="stat-top">
                <span className="stat-label">{s.label}</span>
                <span className="stat-icon" style={{ background: s.solid }}>
                  <Icon size={17} />
                </span>
              </div>
              <div className="stat-value">{s.value}</div>
              <div className="stat-hint">{s.hint}</div>
            </div>
          );
        })}
      </div>

      {subscriptions.length === 0 ? (
        <div className="panel">
          <div className="empty-state">
            <div className="empty-state-title">No subscriptions detected yet</div>
            <div className="empty-state-body">
              Connect Gmail and mint your first single-use card and they&rsquo;ll show up here automatically.
            </div>
          </div>
        </div>
      ) : (
        <>
          {needsYou.length > 0 && (
            <div className="panel" style={{ marginBottom: 22 }}>
              <div className="panel-head">
                <div>
                  <div className="panel-title">Waiting on you</div>
                  <div className="panel-note">Vouch held these instead of charging. Open one to decide.</div>
                </div>
              </div>
              <SubList subs={needsYou} onOpen={onOpen} />
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">All subscriptions</div>
                <div className="panel-note">One card each. It dies after a single charge.</div>
              </div>
            </div>
            <SubList subs={subscriptions} onOpen={onOpen} />
          </div>
        </>
      )}
    </>
  );
}
