import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { TrendingDown, Wallet, PiggyBank, CalendarDays, Landmark, AlertCircle } from "lucide-react";
import BrandLogo from "./BrandLogo";
import type { Budget as BudgetData } from "@/lib/dashboard-types";

const statusWord: Record<string, string> = { renew: "Auto-renew", hold: "Held", ask: "Will ask" };

export default function Budget({ budget, mode }: { budget: BudgetData; mode: "demo" | "real" }) {
  const pct = budget.monthlyCap > 0 ? Math.round((budget.spent / budget.monthlyCap) * 100) : 0;
  const active = budget.lines.filter((l) => l.spent > 0);
  const annualProjected = Math.round(budget.spent * 12);
  const momChange = budget.lastMonth > 0 ? Math.round(((budget.spent - budget.lastMonth) / budget.lastMonth) * 100) : 0;
  const a = budget.account;
  const subsShareOfIncome = a.monthlyIncome ? ((budget.spent / a.monthlyIncome) * 100).toFixed(1) : null;
  const upcomingTotal = budget.upcoming.reduce((s, u) => s + u.amount, 0);
  const next7 = budget.upcoming.filter((u) => u.dueInDays <= 7);
  const next7Total = next7.reduce((s, u) => s + u.amount, 0);
  const dueTomorrow = budget.upcoming.filter((u) => u.dueInDays <= 1);
  const remindTotal = dueTomorrow.reduce((s, u) => s + u.amount, 0);

  const stats = [
    { icon: Wallet, label: "Spent this month", value: `$${budget.spent.toFixed(2)}`, hint: mode === "demo" ? `of $${budget.monthlyCap} budget · ${pct}%` : `vs $${budget.monthlyCap.toFixed(2)} last month · ${pct}%`, solid: "#0d0d0f" },
    { icon: PiggyBank, label: "Not committed", value: `$${budget.saved.toFixed(2)}`, hint: "no active card right now", solid: "#0b8a5a" },
    { icon: TrendingDown, label: "vs last month", value: `${momChange}%`, hint: `from $${budget.lastMonth.toFixed(0)}`, solid: "#1f3df0" },
    { icon: CalendarDays, label: "Projected / year", value: `$${annualProjected.toLocaleString()}`, hint: "at your current pace", solid: "#c47d18" },
  ];

  return (
    <>
      <div className="page-head">
        <div className="page-title">Budget</div>
        <div className="page-sub">
          {mode === "demo" ? "Your subscription spending, connected live to your bank through Plaid." : "Your subscription spending, from Gmail receipts and your connected bank account."}
        </div>
      </div>

      <div className="bank-card">
        <div className="bank-left">
          <div className="bank-logo">
            <Landmark size={20} />
          </div>
          <div>
            <div className="bank-name">
              {a.bank} · {a.name} <span className="bank-mask">••{a.mask}</span>
            </div>
            <div className="bank-sub">
              <span className="plaid-dot" /> Connected via Plaid
            </div>
          </div>
        </div>
        <div className="bank-figures">
          <div className="bank-fig">
            <div className="bank-fig-label">Balance</div>
            <div className="bank-fig-val">${a.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
          <div className="bank-fig">
            <div className="bank-fig-label">Available</div>
            <div className="bank-fig-val">${a.available.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
          </div>
          {subsShareOfIncome !== null ? (
            <div className="bank-fig">
              <div className="bank-fig-label">Subs / income</div>
              <div className="bank-fig-val">{subsShareOfIncome}%</div>
            </div>
          ) : (
            <div className="bank-fig">
              <div className="bank-fig-label">This month</div>
              <div className="bank-fig-val">${budget.spent.toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>

      <div className="stat-grid">
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

      {dueTomorrow.length > 0 && (
        <div className="reminder-banner">
          <span className="reminder-icon">
            <AlertCircle size={18} />
          </span>
          <div className="reminder-text">
            <b>{dueTomorrow.length === 1 ? `${dueTomorrow[0].name} renews tomorrow` : `${dueTomorrow.length} payments renew tomorrow`}</b> — $
            {remindTotal.toFixed(2)} will leave your account within 24 hours. Review before it charges.
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title">Upcoming payments</div>
            <div className="panel-note">
              ${next7Total.toFixed(2)} leaving your account in the next 7 days · ${upcomingTotal.toFixed(2)} this cycle. Vouch reminds you 1 day
              before each charge.
            </div>
          </div>
          <span className="chip hold">
            <AlertCircle size={13} /> {dueTomorrow.length} needs you
          </span>
        </div>
        {budget.upcoming.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-body">Nothing expected to renew in the next two weeks.</div>
          </div>
        ) : (
          <div className="upcoming-list">
            {budget.upcoming.map((u) => (
              <div className="upcoming-row" key={u.id}>
                <BrandLogo name={u.name} initial={u.initial} color={u.color} logo={u.logo} size={38} />
                <div className="upcoming-main">
                  <div className="upcoming-name">{u.name}</div>
                  <div className="upcoming-note">{u.note}</div>
                </div>
                <div className="upcoming-due">
                  <div className={`due-badge ${u.dueInDays <= 1 ? "urgent" : u.dueInDays <= 3 ? "soon" : ""}`}>
                    {u.dueInDays === 0 ? "Today" : u.dueInDays === 1 ? "Tomorrow" : `in ${u.dueInDays} days`}
                  </div>
                </div>
                <div className="upcoming-amt">${u.amount.toFixed(2)}</div>
                <span className={`chip ${u.status}`}>
                  <span className={`dot ${u.status}`} /> {statusWord[u.status]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="budget-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Spend by category</div>
              <div className="panel-note">This month, across {active.length} active categories.</div>
            </div>
          </div>
          {active.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-body">No categorized spend yet this month.</div>
            </div>
          ) : (
            <div className="panel-pad donut-wrap">
              <div className="donut-chart">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={active} dataKey="spent" nameKey="cat" cx="50%" cy="50%" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
                      {active.map((l) => (
                        <Cell key={l.cat} fill={l.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e7e6e2", fontSize: 13 }} formatter={(v: number, n) => [`$${v.toFixed(2)}`, n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="donut-center">
                  <div className="donut-total">${budget.spent.toFixed(0)}</div>
                  <div className="donut-label">this month</div>
                </div>
              </div>
              <div className="donut-legend">
                {active.map((l) => {
                  const share = budget.spent > 0 ? Math.round((l.spent / budget.spent) * 100) : 0;
                  return (
                    <div className="legend-item" key={l.cat}>
                      <span className="legend-swatch" style={{ background: l.color }} />
                      <span className="legend-name">{l.cat}</span>
                      <span className="legend-val">${l.spent.toFixed(2)}</span>
                      <span className="legend-share">{share}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Spend & savings trend</div>
              <div className="panel-note">Last six months.</div>
            </div>
          </div>
          <div className="panel-pad" style={{ height: 292 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={budget.history} margin={{ top: 6, right: 6, left: -20, bottom: 0 }} barGap={2}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#86868f" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#86868f" }} />
                <Tooltip cursor={{ fill: "#f3f2fb" }} contentStyle={{ borderRadius: 10, border: "1px solid #e7e6e2", fontSize: 13 }} formatter={(v: number, n) => [`$${v}`, n === "spent" ? "Spent" : "Saved"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 6 }} formatter={(v) => (v === "spent" ? "Spent" : "Not committed")} />
                <Bar dataKey="spent" fill="#0d0d0f" radius={[5, 5, 0, 0]} />
                <Bar dataKey="saved" fill="#0b8a5a" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 18 }}>
        <div className="panel-head">
          <div>
            <div className="panel-title">Budget vs actual</div>
            <div className="panel-note">{mode === "demo" ? "Set a cap per category. Vouch asks before you go over." : "Each category compared against what you spent in it last month."}</div>
          </div>
        </div>
        {budget.lines.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-body">No categorized spend yet.</div>
          </div>
        ) : (
          <div className="panel-pad">
            {budget.lines.map((l) => {
              const p = Math.min(100, Math.round((l.spent / l.cap) * 100));
              const over = l.spent > l.cap;
              return (
                <div className="budget-line" key={l.cat}>
                  <div className="budget-line-head">
                    <span className="budget-cat">
                      <span className="legend-swatch" style={{ background: l.color }} /> {l.cat}
                    </span>
                    <span className="budget-amt">
                      ${l.spent.toFixed(2)} <span className="muted">/ ${l.cap.toFixed(0)}</span>
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${p}%`, background: over ? "var(--cancel)" : l.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
