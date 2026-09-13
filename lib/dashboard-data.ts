// Assembles the real /dashboard's data from every service branch's tables
// in the shared DB (gmail-connector's gmail_messages/classifications,
// card-issuing's issued_cards/card_transactions, bank-connection's
// plaid_accounts/items, gmail-connector's backboard_assistants,
// voice-verification's voice_enrollments). See docs/DASHBOARD.md for the
// full mapping and what's deliberately left out (usage numbers, income,
// an arbitrary budget cap) because nothing in this codebase measures them.
import { pool } from "@/lib/db";
import { brandFor, categoryFor, colorForCategory } from "@/lib/catalog";
import { analyzeReal } from "@/lib/analyze-real";
import { memoriesForSubscriptions } from "@/lib/backboard-memories";
import type { User } from "@/lib/auth";
import type {
  AnalyzedSubscription,
  Budget,
  BudgetHistoryPoint,
  BudgetLine,
  Connector,
  DashboardData,
  DashboardUser,
  Transaction,
  UpcomingPayment,
} from "@/lib/dashboard-types";

const CYCLE_DAYS = 30;
const DAY_MS = 86_400_000;

function normalizeMerchant(s: string): string {
  return s.trim().toLowerCase();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / DAY_MS));
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface MerchantChargeRow {
  merchant: string;
  charge_count: number;
  last_charge_at: Date;
  last_amount_cents: number;
  prev_amount_cents: number | null;
}

interface IssuedCardRow {
  id: string;
  stripe_card_id: string;
  label: string;
  merchant: string | null;
  last4: string;
  brand: string;
  status: "active" | "inactive" | "canceled";
  created_at: Date;
  spending_limit_cents: number | null;
}

interface SpendRow {
  merchant: string | null;
  amount_cents: number;
  received_at: Date;
}

interface PlaidAccountRow {
  bank: string | null;
  name: string | null;
  mask: string | null;
  balance: string | null;
  available: string | null;
}

interface TransactionRow {
  id: string;
  amount_cents: number;
  merchant_name: string | null;
  occurred_at: Date;
  label: string;
  card_merchant: string | null;
}

interface ConnectorRow {
  source: string;
  detail: string | null;
}

/**
 * Optional-table lookups, each isolated in its own try/catch.
 *
 * These live in migrations owned by other branches (identity-verification,
 * card-issuing) that a given database may not have applied yet. They are
 * deliberately NOT folded into the connectors UNION below: a single missing
 * table would fail that whole query and take the entire dashboard with it,
 * rather than just hiding one row.
 */
async function agentAccessDetail(userId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ active: number; last_used_at: Date | null }>(
      `select count(*) filter (where revoked_at is null)::int as active,
              max(last_used_at) as last_used_at
       from mcp_api_keys where user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row || row.active === 0) return null;
    const used = row.last_used_at
      ? `last used ${new Date(row.last_used_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "never used";
    return `${row.active} key${row.active === 1 ? "" : "s"} · ${used}`;
  } catch {
    return null;
  }
}

async function identityDetail(userId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ status: string }>(
      "select status from identity_verifications where user_id = $1",
      [userId],
    );
    return rows[0]?.status ?? null;
  } catch {
    return null;
  }
}

export async function getRealDashboardData(user: User): Promise<DashboardData> {
  const [charges, cards, spendRows, plaidAccount, txRows, connectorRows, agentAccess, identityStatus] = await Promise.all([
    pool.query<MerchantChargeRow>(
      `select
         m.merchant,
         count(*)::int as charge_count,
         max(m.received_at) as last_charge_at,
         (array_agg(m.amount_cents order by m.received_at desc))[1] as last_amount_cents,
         (array_agg(m.amount_cents order by m.received_at desc))[2] as prev_amount_cents
       from gmail_messages m
       join gmail_message_classifications c on c.message_id = m.id
       where m.user_id = $1
         and c.category_key = 'subscription_signup_renewal'
         and m.merchant is not null
         and m.amount_cents is not null
       group by m.merchant`,
      [user.id],
    ),
    pool.query<IssuedCardRow>(
      `select id, stripe_card_id, label, merchant, last4, brand, status, created_at, spending_limit_cents
       from issued_cards where user_id = $1 order by created_at desc`,
      [user.id],
    ),
    pool.query<SpendRow>(
      `select m.merchant, m.amount_cents, m.received_at
       from gmail_messages m
       join gmail_message_classifications c on c.message_id = m.id
       where m.user_id = $1 and m.amount_cents is not null
         and m.received_at >= (date_trunc('month', now()) - interval '5 months')
       order by m.received_at asc`,
      [user.id],
    ),
    pool.query<PlaidAccountRow>(
      `select pi.institution_name as bank, pa.name as name, pa.mask as mask,
              pa.current_balance as balance, pa.available_balance as available
       from plaid_accounts pa
       join plaid_items pi on pi.item_id = pa.item_id
       where pi.user_id = $1
       order by pa.created_at asc
       limit 1`,
      [user.id],
    ),
    pool.query<TransactionRow>(
      `select ct.id, ct.amount_cents, ct.merchant_name, ct.occurred_at, ic.label, ic.merchant as card_merchant
       from card_transactions ct
       join issued_cards ic on ic.id = ct.card_id
       where ic.user_id = $1
       order by ct.occurred_at desc
       limit 25`,
      [user.id],
    ),
    pool.query<ConnectorRow>(
      `(select 'gmail' as source, google_email as detail from gmail_connections where user_id = $1)
       union all
       (select 'bank' as source, institution_name as detail from plaid_items where user_id = $1 order by created_at asc limit 1)
       union all
       (select 'backboard' as source, assistant_id as detail from backboard_assistants where user_id = $1)
       union all
       (select 'voice' as source, to_char(created_at, 'Mon DD, YYYY') as detail from voice_enrollments where user_id = $1)`,
      [user.id],
    ),
    agentAccessDetail(user.id),
    identityDetail(user.id),
  ]);

  // ---- Subscriptions: merge Gmail-derived merchants with issued cards ----
  const chargesByMerchant = new Map<string, MerchantChargeRow>();
  for (const row of charges.rows) chargesByMerchant.set(normalizeMerchant(row.merchant), row);

  const cardsByMerchant = new Map<string, IssuedCardRow>();
  for (const row of cards.rows) {
    if (!row.merchant) continue;
    const key = normalizeMerchant(row.merchant);
    // rows are already ordered created_at desc, so the first one seen per merchant is the most recent
    if (!cardsByMerchant.has(key)) cardsByMerchant.set(key, row);
  }

  const allKeys = new Set<string>([...chargesByMerchant.keys(), ...cardsByMerchant.keys()]);
  const now = new Date();
  const subscriptions: AnalyzedSubscription[] = [];

  for (const key of allKeys) {
    const charge = chargesByMerchant.get(key);
    const card = cardsByMerchant.get(key);
    const name = charge?.merchant ?? card?.merchant ?? card?.label ?? key;
    const brand = brandFor(name);

    const priceCents = charge?.last_amount_cents ?? card?.spending_limit_cents ?? 0;
    const price = priceCents / 100;

    const rawChangePct =
      charge?.prev_amount_cents && charge.prev_amount_cents > 0
        ? Math.round(((charge.last_amount_cents - charge.prev_amount_cents) / charge.prev_amount_cents) * 100)
        : 0;
    const priceChangePct = Math.max(0, rawChangePct);

    const lastAnchor = charge?.last_charge_at ?? card?.created_at ?? now;
    const renewsIn = charge ? Math.max(0, CYCLE_DAYS - daysBetween(now, lastAnchor)) : null;
    const hasActiveCard = card?.status === "active";

    const analysis = analyzeReal({
      name,
      price,
      priceChangePct,
      hasActiveCard,
      renewsInDays: renewsIn,
      chargeCount: charge?.charge_count ?? 0,
    });

    subscriptions.push({
      id: key.replace(/[^a-z0-9]+/g, "-"),
      logo: brand.logo,
      tint: `linear-gradient(150deg,#17181c 0%,#232634 55%,${brand.color} 170%)`,
      name,
      color: brand.color,
      initial: brand.initial,
      price,
      cycle: "monthly",
      renewsIn,
      card: hasActiveCard && card ? `•••• ${card.last4}` : "closed",
      priceChange: priceChangePct > 0 ? priceChangePct : undefined,
      overlap: null,
      reason: analysis.headline,
      status: analysis.status,
      verdict: analysis.verdict,
      tone: analysis.tone,
      headline: analysis.headline,
      factors: analysis.factors,
      annual: analysis.annual,
    });
  }
  subscriptions.sort((a, b) => (a.renewsIn ?? 999) - (b.renewsIn ?? 999));

  // Attach each merchant's top-k Backboard memories, shown verbatim in the
  // decision popup as supporting evidence. Never throws and never blocks the
  // page — a user with no Gmail/Backboard connection just gets none.
  const memoriesBySub = await memoriesForSubscriptions(user.id, subscriptions);
  for (const sub of subscriptions) {
    const memories = memoriesBySub[sub.id];
    if (memories?.length) sub.memories = memories;
  }

  // ---- Budget: bucket the last 6 months of classified spend by month + category ----
  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const months: { key: string; label: string }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: monthKey(d), label: d.toLocaleString("en-US", { month: "short" }) });
  }
  const currentMonthKey = monthKey(now);
  const prevMonthKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const spendByMonth = new Map<string, number>(months.map((m) => [m.key, 0]));
  const categoryCurrent = new Map<string, number>();
  const categoryPrev = new Map<string, number>();

  for (const row of spendRows.rows) {
    const key = monthKey(new Date(row.received_at));
    const amount = row.amount_cents / 100;
    if (spendByMonth.has(key)) spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + amount);
    const cat = row.merchant ? categoryFor(row.merchant) : "Other";
    if (key === currentMonthKey) categoryCurrent.set(cat, (categoryCurrent.get(cat) ?? 0) + amount);
    if (key === prevMonthKey) categoryPrev.set(cat, (categoryPrev.get(cat) ?? 0) + amount);
  }

  const spent = spendByMonth.get(currentMonthKey) ?? 0;
  const lastMonth = spendByMonth.get(prevMonthKey) ?? 0;
  // "Saved" = price of subscriptions with no currently-active card, i.e. not
  // presently committed to an auto-charge — a real, current-state figure,
  // not a fabricated one. Prior months have no recorded decision, so they
  // show 0 rather than a guessed positive number.
  const saved = subscriptions.filter((s) => s.card === "closed").reduce((sum, s) => sum + s.price, 0);

  const history: BudgetHistoryPoint[] = months.map((m, i) => ({
    month: m.label,
    spent: round2(spendByMonth.get(m.key) ?? 0),
    saved: i === months.length - 1 ? round2(saved) : 0,
  }));

  const allCats = new Set<string>([...categoryCurrent.keys(), ...categoryPrev.keys()]);
  const lines: BudgetLine[] = [...allCats]
    .map((cat) => {
      const spentAmt = categoryCurrent.get(cat) ?? 0;
      const prevAmt = categoryPrev.get(cat) ?? 0;
      // No real per-category limit exists — the comparison basis is last
      // month's real spend in that category, not an invented cap.
      const cap = prevAmt > 0 ? prevAmt : spentAmt;
      return { cat, spent: round2(spentAmt), cap: round2(cap) || 1, color: colorForCategory(cat) };
    })
    .filter((l) => l.spent > 0)
    .sort((a, b) => b.spent - a.spent);

  const a = plaidAccount.rows[0];
  const upcoming: UpcomingPayment[] = subscriptions
    .filter((s): s is AnalyzedSubscription & { renewsIn: number } => s.renewsIn !== null && s.renewsIn <= 14)
    .map((s) => ({
      id: s.id,
      name: s.name,
      logo: s.logo,
      initial: s.initial,
      color: s.color,
      amount: s.price,
      dueInDays: s.renewsIn,
      status: s.status === "cancel" ? ("hold" as const) : s.status,
      note: s.reason,
    }));

  const budget: Budget = {
    monthlyCap: lastMonth || spent,
    spent: round2(spent),
    saved: round2(saved),
    lastMonth: round2(lastMonth),
    account: {
      bank: a?.bank ?? "No bank connected",
      name: a?.name ?? "—",
      mask: a?.mask ?? "----",
      balance: a?.balance ? Number(a.balance) : 0,
      available: a?.available ? Number(a.available) : 0,
    },
    lines,
    upcoming,
    history,
  };

  // ---- Transactions ----
  const transactions: Transaction[] = txRows.rows.map((row) => ({
    id: row.id,
    merchant: row.merchant_name || row.card_merchant || row.label || "Unknown merchant",
    kind: "out",
    amount: row.amount_cents / 100,
    time: new Date(row.occurred_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
    note: "Posted · single-use card",
  }));

  // ---- Connectors ----
  const connMap = new Map(connectorRows.rows.map((r) => [r.source, r.detail]));
  const activeCardCount = cards.rows.filter((c) => c.status === "active").length;
  const stripeConfigured = Boolean(process.env.STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID);

  const connectors: Connector[] = [
    {
      id: "stripe",
      name: "Stripe",
      initial: "S",
      color: "#635bff",
      logo: null,
      state: stripeConfigured ? "connected" : "action",
      detail: stripeConfigured
        ? `Card issuing (sandbox) · ${activeCardCount} active card${activeCardCount === 1 ? "" : "s"}`
        : "Not configured yet",
    },
    {
      id: "bank",
      name: "Bank account",
      initial: "B",
      color: "#0b8a5a",
      logo: null,
      state: connMap.has("bank") ? "connected" : "action",
      detail: connMap.has("bank") ? `${connMap.get("bank")} · via Plaid` : "Connect a bank account",
    },
    {
      id: "gmail",
      name: "Gmail",
      initial: "G",
      color: "#ea4335",
      logo: "/gmail-logo.png",
      state: connMap.has("gmail") ? "connected" : "action",
      detail: connMap.has("gmail") ? `${connMap.get("gmail")} · synced` : "Connect Gmail",
    },
    {
      id: "backboard",
      name: "Backboard",
      initial: "B",
      color: "#0d0d0f",
      logo: null,
      state: connMap.has("backboard") ? "connected" : "action",
      detail: connMap.has("backboard") ? "Memory & routing synced" : "Not connected yet",
    },
    {
      id: "identity",
      name: "Identity",
      initial: "I",
      color: "#4f46e5",
      logo: null,
      // Only `approved` means verified — `completed` just means the user
      // reached the last screen of Persona's flow. See the
      // identity-verification branch's docs/IDENTITY.md.
      state: identityStatus === "approved" ? "connected" : "action",
      detail:
        identityStatus === "approved"
          ? "ID + selfie verified · via Persona"
          : identityStatus
            ? `Verification ${identityStatus.replace(/_/g, " ")}`
            : "Verify to let Vouch act for you",
    },
    {
      id: "mcp",
      name: "Agent access",
      initial: "M",
      color: "#0f766e",
      logo: null,
      // The card-issuing branch's MCP server: it exposes card issuance as
      // MCP tools, so Claude (or any MCP-speaking agent) can mint, freeze
      // and cancel cards on this user's behalf with a bearer key.
      state: agentAccess ? "connected" : "action",
      detail: agentAccess ? `MCP · ${agentAccess}` : "No agent keys yet",
    },
    {
      id: "voice",
      name: "Voice",
      initial: "V",
      color: "#7c3aed",
      logo: null,
      state: connMap.has("voice") ? "connected" : "action",
      detail: connMap.has("voice") ? `Enrolled ${connMap.get("voice")}` : "Register your voice",
    },
  ];

  const dashboardUser: DashboardUser = {
    name: user.name || user.email.split("@")[0],
    role: "Account owner",
    email: user.email,
    plan: "Vouch Beta",
    initials: initialsFor(user.name || user.email),
    memberSince: user.createdAt.toLocaleString("en-US", { month: "short", year: "numeric" }),
  };

  return { subscriptions, transactions, budget, connectors, user: dashboardUser };
}
