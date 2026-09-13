import { useState } from "react";
import { TrendingUp, TrendingDown, Minus, PiggyBank, Scale, Sparkles, ChevronDown, Check, X, AlertTriangle } from "lucide-react";
import BrandLogo from "./BrandLogo";
import type { AnalyzedSubscription } from "@/lib/dashboard-types";

const verdictIcon = { Keep: Check, Cancel: X, Review: AlertTriangle };

export default function Analysis({ subscriptions, mode }: { subscriptions: AnalyzedSubscription[]; mode: "demo" | "real" }) {
  const [open, setOpen] = useState<string | null>(null);
  const rows = subscriptions;
  const totalSpend = rows.reduce((a, s) => a + s.price, 0);
  const saved = rows.filter((s) => s.verdict !== "Keep").reduce((a, s) => a + s.price, 0);
  const worthKeeping = rows.filter((s) => s.verdict === "Keep" && s.worth !== undefined).reduce((a, s) => a + (s.worth ?? 0), 0);
  const showWorth = mode === "demo";

  const stats = showWorth
    ? [
        { icon: PiggyBank, label: "Potential savings", value: `$${saved.toFixed(2)}/mo`, hint: `$${(saved * 12).toFixed(0)}/yr if you act on flags`, solid: "#0b8a5a" },
        { icon: Scale, label: "Monthly spend", value: `$${totalSpend.toFixed(2)}`, hint: `${rows.length} subscriptions`, solid: "#0d0d0f" },
        { icon: Sparkles, label: "Value you keep", value: `$${worthKeeping}`, hint: "worth of what earns its charge", solid: "#1f3df0" },
      ]
    : [
        { icon: Scale, label: "Monthly spend", value: `$${totalSpend.toFixed(2)}`, hint: `${rows.length} subscription${rows.length === 1 ? "" : "s"}`, solid: "#0d0d0f" },
        { icon: PiggyBank, label: "Flagged for review", value: rows.filter((s) => s.verdict === "Review").length, hint: "price jumps or missing cards", solid: "#c47d18" },
        { icon: Sparkles, label: "Set to renew", value: rows.filter((s) => s.status === "renew").length, hint: "already have an active card", solid: "#1f3df0" },
      ];

  return (
    <>
      <div className="page-head">
        <div className="page-title">Subscription analysis</div>
        <div className="page-sub">
          {showWorth
            ? "What each subscription is worth to you, and whether it should renew. Open any row for the full reasoning."
            : "What Vouch can tell from price history and card status — no usage tracking exists yet, so nothing here is a usage guess. Open any row for the full reasoning."}
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div className="stat" key={s.label} style={{ ["--accent" as string]: s.solid }}>
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

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Per-subscription breakdown</div>
            <div className="panel-note">
              {showWorth ? "Value is estimated from your usage against what you pay. Click a row to expand." : "Click a row to expand."}
            </div>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-body">Nothing to analyze yet — connect Gmail or mint a card first.</div>
          </div>
        ) : (
          <div className="analysis-list">
            {rows.map((s) => {
              const TrendIcon = s.trend === "up" ? TrendingUp : s.trend === "down" ? TrendingDown : Minus;
              const VIcon = verdictIcon[s.verdict];
              const isOpen = open === s.id;
              return (
                <div className={`analysis-block ${isOpen ? "open" : ""}`} key={s.id}>
                  <button className={`analysis-row ${showWorth ? "" : "no-worth"}`} onClick={() => setOpen(isOpen ? null : s.id)}>
                    <BrandLogo name={s.name} initial={s.initial} color={s.color} logo={s.logo} size={40} />
                    <div className="analysis-main">
                      <div className="sub-name">{s.name}</div>
                      <div className="sub-meta">
                        {s.usage30 !== undefined ? (
                          <>
                            {s.usage30} {s.usageUnit} · <TrendIcon size={11} style={{ verticalAlign: "-1px" }} /> {s.trend}
                          </>
                        ) : (
                          <>${s.price.toFixed(2)}/mo · {s.card === "closed" ? "no active card" : "card active"}</>
                        )}
                        {!!s.priceChange && <span className="price-up"> · price +{s.priceChange}%</span>}
                      </div>
                    </div>
                    {showWorth && s.worth !== undefined && s.valuePct !== undefined && (
                      <div className="analysis-worth">
                        <div className="worth-head">
                          <span className="worth-you-pay">You pay ${s.price.toFixed(2)}</span>
                          <span className="worth-value" style={{ color: s.valuePct >= 100 ? "var(--renew)" : "var(--hold)" }}>
                            worth ${s.worth}
                          </span>
                        </div>
                        <div className="worth-bar">
                          <div
                            className="worth-fill"
                            style={{ width: `${Math.min(100, s.valuePct)}%`, background: s.valuePct >= 100 ? "var(--renew)" : s.valuePct >= 60 ? "var(--hold)" : "var(--cancel)" }}
                          />
                          <div className="worth-mark" />
                        </div>
                      </div>
                    )}
                    <div className={`chip ${s.tone}`} style={{ justifySelf: "end" }}>
                      <span className={`dot ${s.tone}`} /> {s.verdict}
                    </div>
                    <ChevronDown className="analysis-chevron" size={18} />
                  </button>

                  {isOpen && (
                    <div className="analysis-detail">
                      <div className="detail-verdict">
                        <span className={`detail-badge ${s.tone}`}>
                          <VIcon size={14} /> {s.verdict}
                        </span>
                        <p className="detail-headline">{s.headline}</p>
                      </div>

                      <div className="detail-grid">
                        <div className="detail-col">
                          <div className="detail-col-title">Why</div>
                          <ul className="detail-factors">
                            {s.factors.map((f, i) => (
                              <li key={i} className={f.good ? "good" : "bad"}>
                                {f.good ? <Check size={14} /> : <X size={14} />} {f.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="detail-col">
                          <div className="detail-col-title">The numbers</div>
                          <div className="detail-stat">
                            <span>Monthly cost</span>
                            <b>${s.price.toFixed(2)}</b>
                          </div>
                          <div className="detail-stat">
                            <span>Annual cost</span>
                            <b>${s.annual}</b>
                          </div>
                          {s.usage30 !== undefined && (
                            <div className="detail-stat">
                              <span>Usage (30d)</span>
                              <b>
                                {s.usage30} {s.usageUnit}
                              </b>
                            </div>
                          )}
                          {showWorth && s.worth !== undefined && s.valuePct !== undefined && (
                            <div className="detail-stat">
                              <span>Est. value</span>
                              <b style={{ color: s.valuePct >= 100 ? "var(--renew)" : "var(--hold)" }}>${s.worth}/mo</b>
                            </div>
                          )}
                          <div className="detail-stat">
                            <span>Renews in</span>
                            <b>{s.renewsIn === null ? "unknown" : `${s.renewsIn} day${s.renewsIn === 1 ? "" : "s"}`}</b>
                          </div>
                        </div>
                      </div>

                      <div className="detail-actions">
                        {s.verdict === "Keep" ? (
                          <button className="btn btn-renew btn-sm">Keep & auto-renew</button>
                        ) : (
                          <button className="btn btn-cancel btn-sm">Cancel {s.name}</button>
                        )}
                        <button className="btn btn-ghost btn-sm">Ask me at renewal</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="analysis-legend">
        <span>
          <span className="dot renew" /> Keep — earns its charge
        </span>
        <span>
          <span className="dot hold" /> Review — worth a second look
        </span>
        {showWorth && (
          <span>
            <span className="dot cancel" /> Cancel — no recent usage
          </span>
        )}
        <span className="legend-mark">{showWorth ? "The line marks what you pay; the bar is estimated value." : "Based on price history and card status only."}</span>
      </div>
    </>
  );
}
