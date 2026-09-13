// Shared shape between the real dashboard (app/dashboard, backed by the
// actual DB) and the demo dashboard (app/demo, backed by lib/seed.ts's
// mock data ported from vouch-ui). Both feed the same components in
// components/dashboard/*, so a real subscription and a seeded one have to
// satisfy the same interface.
//
// Usage-derived fields (usage30/usageUnit/trend/overlap) and the dollar
// "worth" estimate are optional and demo-only: there is no usage-tracking
// integration for any real service, so real data leaves them undefined
// rather than inventing a plausible-looking number. See docs/DASHBOARD.md.

import type { RetrievedMemory } from "@/lib/memory-schema";

export type { RetrievedMemory };

export type SubStatus = "renew" | "hold" | "ask" | "cancel";
export type Tone = "renew" | "hold" | "cancel";
export type Verdict = "Keep" | "Cancel" | "Review";

export interface Subscription {
  id: string;
  logo: string | null;
  tint: string;
  name: string;
  color: string;
  initial: string;
  price: number;
  cycle: "monthly" | "yearly";
  /** Days until the next expected charge, or null when there's no basis to estimate one. */
  renewsIn: number | null;
  /** Masked last4 as "•••• 1234", or the literal "closed" when no active card is minted. */
  card: string;
  status: SubStatus;
  reason: string;
  usage30?: number;
  usageUnit?: string;
  trend?: "up" | "down" | "flat";
  /** Percent change vs the previous charge for this merchant. */
  priceChange?: number;
  overlap?: string | null;
  /**
   * Top-k Backboard memories for this merchant, in Backboard's own relevance
   * order, shown verbatim (see lib/backboard-memories.ts). Real dashboard
   * only — the demo has no memory store to read from.
   */
  memories?: RetrievedMemory[];
}

export interface Factor {
  good: boolean;
  text: string;
}

export interface Analysis {
  verdict: Verdict;
  tone: Tone;
  headline: string;
  factors: Factor[];
  annual: string;
  /** Estimated dollar value of what you get for the price — demo only (see above). */
  worth?: number;
  valuePct?: number;
}

export type AnalyzedSubscription = Subscription & Analysis;

export interface Transaction {
  id: string;
  merchant: string;
  kind: "in" | "out" | "declined";
  amount: number;
  time: string;
  note: string;
}

export interface BudgetLine {
  cat: string;
  spent: number;
  cap: number;
  color: string;
}

export interface UpcomingPayment {
  id: string;
  name: string;
  logo: string | null;
  initial: string;
  color: string;
  amount: number;
  dueInDays: number;
  status: "renew" | "hold" | "ask";
  note: string;
}

export interface BudgetHistoryPoint {
  month: string;
  spent: number;
  saved: number;
}

export interface BudgetAccount {
  bank: string;
  name: string;
  mask: string;
  balance: number;
  available: number;
  /** Demo only — Plaid gives us balances, not income; real budgets omit this. */
  monthlyIncome?: number;
}

export interface Budget {
  /** Demo: an arbitrary user-set cap. Real: last month's spend, so "vs actual" stays honest (see docs/DASHBOARD.md). */
  monthlyCap: number;
  spent: number;
  saved: number;
  lastMonth: number;
  account: BudgetAccount;
  lines: BudgetLine[];
  upcoming: UpcomingPayment[];
  history: BudgetHistoryPoint[];
}

export interface Connector {
  id: string;
  name: string;
  initial: string;
  color: string;
  logo: string | null;
  state: "connected" | "action";
  detail: string;
}

export interface DashboardUser {
  name: string;
  role: string;
  email: string;
  plan: string;
  initials: string;
  memberSince: string;
}

export interface DashboardData {
  subscriptions: AnalyzedSubscription[];
  transactions: Transaction[];
  budget: Budget;
  connectors: Connector[];
  user: DashboardUser;
}
