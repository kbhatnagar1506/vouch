# `dashboard` service

| | |
|---|---|
| **Branch** | `dashboard` (ref `origin/dashboard`) |
| **Subdomain** | `dashboard.getvouch.club` |
| **Role** | The product surface — the UI a user lands on after onboarding (Gmail → bank → voice), showing subscriptions, cards, budget, analysis, transactions, connectors, settings, and the "Call me" feature |
| **Position in the flow** | Terminal step: `login` → `gmail` → `bank` *(skippable)* → `voice` → **`dashboard`** |
| **Owns in the DB** | No tables of its own — see [§10](#10-database-schema) and [§4](#4-how-subscriptions-are-derived-cross-branch-data-access)|

This document was produced by reading the branch's own `docs/DASHBOARD.md` and `CLAUDE.md` as a baseline, then verifying every claim against the actual source on `origin/dashboard`, plus the relevant tables/routes on `gmail-connector`, `card-issuing`, `bank-connection`, `voice-verification`, and `calling-agent` where the dashboard reads or calls into them directly.

---

## 1. Purpose & role

`dashboard` ports a HackRice 16 hackathon UI (`kbhatnagar1506/vouch-ui`) into this repo as the final onboarding step and the app's main surface. It is the only branch a returning user actually lives in day to day: it shows what subscriptions Vouch has detected, which ones have a live single-use card, a Plaid-backed budget view, a rule-based renew/hold/ask verdict per subscription, raw supporting evidence from Backboard memory, and the "Call me" voice-confirmation entry point. It is also, by file count, the largest branch in the repo — 13 components versus a handful on every other service branch.

It plays two roles simultaneously via two routes on one component tree:

- **`/dashboard`** — real, authenticated, reads the shared Postgres DB.
- **`/demo`** — public, unauthenticated, renders the identical UI against static mock data. See [§3](#3-real-vs-demo-split).

## 2. Full file & directory structure

Verified via `git ls-tree -r --name-only origin/dashboard`. A few files exist beyond the task's known-file list (`app/globals.css`, `next.config.ts`, `tsconfig.json`, `package.json`/`package-lock.json`, `.env.example`, `.gitignore`, `public/gmail-logo.png`) — included below for completeness.

### App routes (`app/`)

| File | Purpose |
|---|---|
| `app/layout.tsx` | Root HTML shell. Imports `globals.css`, sets static metadata (`title`/`description` = "Vouch"). No providers, no fonts config beyond CSS. |
| `app/page.tsx` | Bare `/` → `redirect("/dashboard")`. Added by the "Redirect the bare dashboard domain to /dashboard" commit — the bare domain used to still show the Next.js scaffold's DB health-check page; middleware still gates the destination for signed-out visitors. |
| `app/dashboard/page.tsx` | The real dashboard. Server component: calls `getCurrentUser()`, redirects to the portal login if absent (belt-and-suspenders behind `middleware.ts`), calls `getRealDashboardData(user)`, renders `<DashboardShell mode="real" .../>`. |
| `app/dashboard/loading.tsx` | Next.js's automatic Suspense fallback while the async `page.tsx` awaits DB data. Static skeleton grid (no client JS) laid out to match the real shell so nothing shifts on swap-in. |
| `app/demo/page.tsx` | The public demo. Client-independent server component: imports `lib/seed.ts` + `lib/analyze-demo.ts` directly, renders `<DashboardShell mode="demo" .../>`. No auth, no DB. |
| `app/globals.css` | Hand-written CSS (736 lines) inherited verbatim from the vouch-ui hackathon project — **not** Tailwind, unlike most other branches. Defines every component class (`.stat`, `.panel`, `.vcard`, `.chip`, `.popup-*`, etc.) plus animation keyframes (`fade`, `pop`, `pageIn`, `shimmer`, `pulse`, `spin`); `.page-transition` and `.skeleton` both respect `prefers-reduced-motion`. |

### API routes (`app/api/`)

| File | Purpose |
|---|---|
| `app/api/auth/logout/route.ts` | `POST` — clears the session cookie. |
| `app/api/auth/me/route.ts` | `GET` — returns the current session user or `null`. |
| `app/api/dashboard/call-me/route.ts` | `POST` — proxies "Call me" to the `calling-agent` branch. |
| `app/api/dashboard/resolve/route.ts` | `POST` — mints or cancels a card for a subscription decision. |
| `app/api/health/route.ts` | `GET` — unauthenticated DB connectivity check. |

Full request/response contracts in [§9](#9-every-api-route).

### Components (`components/dashboard/`)

All 13 files — this is the component inventory the task asked for:

| Component | Renders / does |
|---|---|
| **`DashboardShell.tsx`** | `"use client"` root state container. Owns: active nav page, `subscriptions` state (patched optimistically after a resolve), popup open/close, shared phone-number input state, `resolve(id, action)` (in `demo` mode fakes success client-side with no network call; in `real` mode `POST`s `/api/dashboard/resolve`), `onLogout` (`POST /api/auth/logout` then redirect). Renders `Sidebar` + the selected page component (remounted under a `key={page}` inside `.page-transition` for the fade/slide) + `CardPopup`. |
| **`Sidebar.tsx`** | Left nav: `Logo` + brand name, 7 nav tabs (Overview/Cards/Budget/Analysis/Transactions/Connectors/Settings, `lucide-react` icons) with an active-card-count badge on the Cards tab, a "Your subscriptions" quick-jump list (`BrandLogo` + colored status dot per sub, opens the popup on click), `CallMeButton`, and a user row (avatar initials, name, role, logout icon button — logout only rendered when `mode==="real"`). |
| **`Overview.tsx`** | Landing page. 4 stat cards (Monthly commit, Active cards, Saved this month, Needs you), an empty state if there are zero subscriptions, a "Waiting on you" panel (subs with status `ask`/`hold`) shown only when non-empty, and an "All subscriptions" panel — both list bodies delegate to `SubList`. |
| **`Cards.tsx`** | The card wall. Splits subscriptions into Active vs. "Spent & closed", each rendered as a `VouchCard` (local sub-component) — a virtual-card tile styled with the subscription's brand-gradient `tint`, masked number, merchant/renewal footer; dead cards get a grayscale filter and a "Single use spent" stamp. Click opens the popup. |
| **`Budget.tsx`** | Bank-account summary card (balance/available, "Connected via Plaid"), 4 stat cards, a "renews tomorrow" reminder banner (conditional), an upcoming-payments list, a spend-by-category donut (`recharts` `PieChart`) with a legend, a 6-month spend-vs-"not committed" bar chart (`recharts` `BarChart`), and per-category budget-vs-actual bars. |
| **`Analysis.tsx`** | Expandable per-subscription verdict table. 3 stat cards (composition differs by mode — demo shows "Potential savings"/"Value you keep" $-worth stats; real shows "Flagged for review"/"Set to renew" counts, since there's no `worth` to sum). Each row expands to a `factors` list, a numbers grid, and — **not wired to any handler in either mode** — three decorative action buttons ("Keep & auto-renew" / "Cancel {name}" / "Ask me at renewal"). |
| **`Transactions.tsx`** | Chronological activity feed. Banner copy differs by mode ("Live feed via Claude MCP" for demo vs. "Live feed from Stripe Issuing" for real) — both are static UI text, not live streams. |
| **`Connectors.tsx`** | Grid of connector cards (5 in real mode, 10 in demo) with connected/action state and a detail line. |
| **`Settings.tsx`** | Account panel (avatar/name/email/plan/member-since), and three groups of toggles — decision-engine mode, "never cancel Spotify", "ask over $30", voice prompts/tone, card-issuer chip ("Stripe · sandbox"). **All of it is local `useState`** — no `fetch`, no persistence, not wired to `analyze-real.ts` or anything else. A note in real mode says as much ("Preview controls — the current build always uses the careful, rule-based logic"). |
| **`CardPopup.tsx`** | The decision modal, opened from anywhere a subscription row/card is clicked. Shows: the virtual-card face (dead/active styling), verdict header + `reason`, an evidence list (usage/trend/overlap rows only populate in demo — real subs leave those `undefined`; price-change and renews-in rows are common to both), the Backboard memories list when present (real mode only — see [§7](#7-backboard-memories-display)), a phone-number capture step (`needsPhone`, first mint only), the "Mint card & renew" / "Keep it dead" buttons wired to `onResolve`, a voice-hint footer line, and a success state (checkmark/ban icon, auto-closes after 1.3s) that both modes render. |
| **`CallMeButton.tsx`** | The Sidebar's phone-call trigger. State machine `idle → asking (collect phone) → calling → done/error`. Demo mode fakes the whole sequence with `setTimeout`s and never touches the network. Real mode `POST`s `/api/dashboard/call-me`. See [§6](#6-call-me-proxy). |
| **`SubList.tsx`** | Shared row renderer used by `Overview`'s two panels: `BrandLogo`, name, usage-or-"Last charge" line, price column, card column (masked number or a "✕ closed" state), status chip. |
| **`BrandLogo.tsx`** | Ported verbatim from vouch-ui. Renders the merchant's real logo image in a white rounded tile when one exists, else a colored lettermark square. |
| **`Logo.tsx`** | Static inline SVG of the Vouch "V" mark (ported verbatim). Used in the sidebar brand row and on every virtual card face. |

### `lib/`

| File | Purpose |
|---|---|
| `lib/auth.ts` | `User` type; `getUserById()` (`select id, email, name, created_at from users`); re-exports the session-token primitives so other files only need one import path. |
| `lib/session.ts` | `getCurrentUser()` / `requireUser()` for Server Components & Route Handlers — Node runtime, reads `cookies()` from `next/headers`, then hits the DB via `getUserById`. |
| `lib/session-token.ts` | Pure JWT verify/sign (`jose`, HS256), **no `pg` import** — used from `middleware.ts` on the Edge runtime, which can't load `pg`. `SESSION_COOKIE = "vouch_session"`, 30-day TTL. Must match the `portal` branch's `JWT_SECRET` exactly (interoperable: portal signs with `jsonwebtoken`, this verifies with `jose`, same RFC 7519 format). |
| `lib/db.ts` | Lazily-constructed `pg.Pool` behind a `Proxy`, so importing this module doesn't throw at build time when `DATABASE_URL` isn't set yet. This is a **per-branch copy** of the same pattern used on every other branch, not literally shared code (see [§4](#4-how-subscriptions-are-derived-cross-branch-data-access)). |
| `lib/dashboard-data.ts` | `getRealDashboardData(user)` — assembles the entire real `DashboardData` object. See [§4](#4-how-subscriptions-are-derived-cross-branch-data-access). |
| `lib/analyze-real.ts` | `analyzeReal()` — the rule-based renew/hold/ask engine. See [§5](#5-the-rule-based-decision-engine). |
| `lib/analyze-demo.ts` | `analyzeDemo()` — usage-based verdict/worth scoring, ported verbatim from vouch-ui's `Analysis.jsx`. Demo-only (needs `usage30`/`usageUnit`, which only the seed data has). |
| `lib/dashboard-types.ts` | Shared TypeScript contract for both real and demo data: `Subscription`, `Analysis`, `AnalyzedSubscription`, `Transaction`, `Budget`(+`BudgetLine`/`BudgetAccount`/`BudgetHistoryPoint`/`UpcomingPayment`), `Connector`, `DashboardUser`, `DashboardData`. Re-exports `RetrievedMemory` from `lib/memory-schema.ts`. Usage-derived fields (`usage30`, `usageUnit`, `trend`, `overlap`) and `worth`/`valuePct` are optional and demo-only by convention. |
| `lib/catalog.ts` | Static 30-entry brand catalog (name/color/price/category/logo path/initial), ported verbatim from vouch-ui. `brandFor()`, `categoryFor()`, `colorForCategory()`, `findCatalogEntry()` fuzzy-match a real merchant name (normalized, substring-tolerant) against it — this is static brand metadata, not user data. |
| `lib/seed.ts` | Static mock data for `/demo` only (5 subscriptions, transactions, a budget, 10 connectors, 1 user), ported verbatim from vouch-ui's `src/data/seed.js`. |
| `lib/backboard-memories.ts` | Read-only Backboard client for the dashboard. See [§7](#7-backboard-memories-display). |
| `lib/memory-schema.ts` | Pure shaping/validation of a Backboard memory-search response into `RetrievedMemory[]`. See [§11](#11-libmemory-schemats). |
| `lib/stripe-mint.ts` | Card mint/cancel logic — a trimmed, self-contained copy of `card-issuing`'s Stripe code. See [§8](#8-card-minting). |
| `lib/__tests__/memory-schema.test.ts` | Vitest unit tests for `memory-schema.ts`. See [§13](#13-testing). |

### Database (`db/`, `scripts/`)

| File | Purpose |
|---|---|
| `db/migrations/0001_users_name.sql` | `alter table users add column if not exists name text not null default '';` — see [§10](#10-database-schema) for the cross-branch collision with `card-issuing`'s `0004_users_name.sql`. |
| `scripts/migrate.mjs` | Minimal migration runner: applies `db/migrations/*.sql` in filename order inside a transaction each, tracks applied filenames in a `_migrations(name text primary key, applied_at)` table. No ORM, no down-migrations. Identical pattern to every other branch's own copy of this script. |

### Config

| File | Purpose |
|---|---|
| `package.json` | Next 15.5.25, React 19.1.1, TypeScript 5.7.3 (strict). Notable deps: `pg` 8.13.1, `jose` 6.2.12, `stripe` 17.5.0 + `@stripe/stripe-js` 5.5.0, `recharts` 2.15.0, `lucide-react` 0.469.0. Dev: `vitest` ^2.1.9, `vite-tsconfig-paths`. Scripts: `dev`/`build`/`start`/`lint`, `db:migrate` (`node --env-file=.env scripts/migrate.mjs`), `test`/`test:watch`. |
| `next.config.ts` | Default/empty `NextConfig`. |
| `tsconfig.json` | `strict: true`, `@/*` path alias to repo root. |
| `middleware.ts` | Edge middleware — see [§9](#9-every-api-route) intro. |
| `vitest.config.mts` | See [§13](#13-testing). |
| `.env.example` | See [§12](#12-environment-variables). |

### `public/`

| Path | Purpose |
|---|---|
| `public/assets/logos/*.svg` (20 files) | Static brand logos for known subscription merchants, referenced by `lib/catalog.ts`: **Apple Music, Audible, Claude, Dropbox, Duolingo, Figma, GitHub, Google Drive, Grammarly, HBO Max, iCloud, Netflix, Notion, NYT, Paramount+, Patreon, Spotify, Twitch, YouTube, Zoom.** (Catalog entries without a matching SVG — Amazon Prime, Disney+, Hulu, OpenAI, Adobe CC, Microsoft 365, Slack, Canva, Peacock, LinkedIn Premium — fall back to a colored lettermark via `BrandLogo`.) |
| `public/gmail-logo.png` | Gmail's own logo, used only for the Gmail row in `Connectors.tsx`/`Budget.tsx` — not part of the merchant brand catalog since Gmail isn't a subscription. |

---

## 3. Real vs demo split

Confirmed by direct inspection of imports — the two data paths **do not cross**:

- `app/dashboard/page.tsx` imports only `lib/session`, `lib/dashboard-data` (which pulls in `lib/analyze-real`, `lib/backboard-memories`, `lib/catalog`, `lib/db`), and `components/dashboard/DashboardShell`. It never imports `lib/seed` or `lib/analyze-demo`.
- `app/demo/page.tsx` imports only `lib/seed`, `lib/analyze-demo`, and `components/dashboard/DashboardShell`. It never imports `lib/dashboard-data`, `lib/analyze-real`, or `lib/db` — **the demo route never touches the database at all.**
- `middleware.ts`'s `PROTECTED_PAGE_PREFIXES`/`PROTECTED_API_PREFIXES` list only `/dashboard` and `/api/dashboard` — `/demo` is intentionally absent, so it's public.

The only thing the two routes share is the presentational component tree (`components/dashboard/*`) and the `DashboardData`/`Subscription`/etc. type contract in `lib/dashboard-types.ts`, which both a real row and a seeded row must satisfy. Every component that behaves differently by mode takes an explicit `mode: "demo" | "real"` prop (`DashboardShell`, `CallMeButton`, `CardPopup`, `Budget`, `Analysis`, `Transactions`, `Settings`) rather than inferring it — this confirms root `ARCHITECTURE.md`'s "the two never mix" claim precisely, at the import level, not just the UI level.

| Concept | `/demo` | `/dashboard` (real) |
|---|---|---|
| Subscriptions | 5 hardcoded (`lib/seed.ts`) | Derived from `gmail_messages`/`gmail_message_classifications` merged with `issued_cards` |
| Usage numbers (plays/rides/hours), trend, overlap | Seeded | **Never shown** — no usage-tracking integration exists anywhere in this codebase; fields stay `undefined` |
| Verdict engine | `analyzeDemo()` — usage/value scoring, can return `Cancel` | `analyzeReal()` — price/card/date rules, **never** returns `Cancel` |
| "Worth $X" value estimate | Shown | Omitted (inherently usage-derived) |
| Budget cap | Arbitrary `$120` | Last month's real spend (so "% of budget" reads as "vs last month") |
| "Subs / income" | Seeded `monthlyIncome` | Omitted (Plaid gives balances, not income) — replaced with "This month" spend |
| Category labels | Seeded per subscription | Looked up from the static `lib/catalog.ts` by merchant name match |
| Transactions | Seeded, includes a "declined" example | `card_transactions` — real posted charges only; `kind` is always `"out"`, no declines recorded anywhere |
| Connectors | 10 seeded (Lithic, Claude, OpenAI, Gemini, Tiger Data, ElevenLabs, …) | 5 real: Stripe, Bank, Gmail, Backboard, Voice |
| Settings → Issuer | "Lithic · sandbox" | "Stripe · sandbox" |
| Settings toggles | Local state, unwired | Same — local state, unwired, with an explicit "Preview controls" note |
| Backboard memories panel | Never shown (no memory store) | Shown when present |

---

## 4. How subscriptions are derived (cross-branch data access)

`lib/dashboard-data.ts`'s `getRealDashboardData(user)` fires **6 SQL queries in parallel** (`Promise.all`) directly against the shared Postgres pool, then assembles everything client-side in TypeScript. This is the precise cross-branch detail the task asked to confirm:

> **`dashboard` queries other branches' tables with raw, direct SQL through the same `pg.Pool` it would use for its own data — there is no API call, no message queue, and no access-control boundary between branches at the database layer.** "Ownership" in root `ARCHITECTURE.md`'s table is a documentation convention (which branch's `db/migrations/` created the table) — not a technical one. Any branch holding the same `DATABASE_URL` can read or write any table, and `dashboard` does both.

`lib/db.ts` itself is *not* literally shared code — per the root `CLAUDE.md`/`ARCHITECTURE.md` convention, every branch has its own copy of the same "lazy pool behind a Proxy" file, all pointed at the one shared `DATABASE_URL`.

Tables this branch touches that it does not own:

| Table | Created on | Accessed from (this branch) | Read/Write |
|---|---|---|---|
| `gmail_messages` | `gmail-connector` | `lib/dashboard-data.ts` (2 queries) | read |
| `gmail_message_classifications` | `gmail-connector` | `lib/dashboard-data.ts` (joined into both above) | read |
| `gmail_connections` | `gmail-connector` | `lib/dashboard-data.ts` (connectors query) | read |
| `backboard_assistants` | `gmail-connector` | `lib/dashboard-data.ts` (connectors query) + `lib/backboard-memories.ts` | read |
| `issued_cards` | `card-issuing` | `lib/dashboard-data.ts` (read), `lib/stripe-mint.ts` (insert/update), `app/api/dashboard/resolve/route.ts` (read) | read + write |
| `card_transactions` | `card-issuing` | `lib/dashboard-data.ts` | read |
| `stripe_cardholders` | `card-issuing` | `lib/stripe-mint.ts` | read + write |
| `plaid_items` | `bank-connection` | `lib/dashboard-data.ts` (2 queries) | read |
| `plaid_accounts` | `bank-connection` | `lib/dashboard-data.ts` | read |
| `voice_enrollments` | `voice-verification` | `lib/dashboard-data.ts` (connectors query) | read |
| `users` | attributed to `portal` in root `ARCHITECTURE.md`, but actually `CREATE TABLE`'d in `bank-connection`'s `0002_users.sql` | `lib/auth.ts` (read), `db/migrations/0001_users_name.sql` (alter) | read + alter |

### The subscription-derivation queries, exactly as written

```sql
-- 1. Per-merchant Gmail charge history (last 2 charges via array_agg, for price-change detection)
select
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
group by m.merchant

-- 2. This user's issued cards (all statuses, newest first)
select id, stripe_card_id, label, merchant, last4, brand, status, created_at, spending_limit_cents
from issued_cards where user_id = $1 order by created_at desc
```

**Merge logic:** merchant names are normalized (`trim().toLowerCase()`) into a join key. `allKeys` is the *union* of merchants seen in Gmail charges and merchants seen on issued cards — so a card minted with no matching Gmail history yet (or a Gmail-detected subscription with no card minted) still shows up as one subscription row, with whichever side is missing left `undefined`/defaulted. For cards, since rows are pre-sorted `created_at desc`, the **most recent** card per merchant wins when more than one exists for the same merchant.

`name` resolution order: `charge.merchant ?? card.merchant ?? card.label ?? <normalized key>`. Brand styling (`color`/`initial`/`logo`) comes from `lib/catalog.ts`'s `brandFor(name)` — a static lookup, never a DB read.

**Category labels are a separate concept from Gmail's classification.** `gmail_message_classifications.category_key` is only ever used here as a *filter* (`= 'subscription_signup_renewal'`) to select which emails count as subscription signals at all — it is never read as the subscription's display category. The Budget page's per-category breakdown instead calls `lib/catalog.ts`'s `categoryFor(merchantName)`, which matches the merchant name against the static 30-brand catalog and falls back to `"Other"`. So a real subscription's "category" (Streaming, AI & tools, …) comes from static brand metadata this branch owns, not from any DB column gmail-connector wrote.

### Everything else `getRealDashboardData` assembles

- **Price change %**: `priceChangePct = max(0, round(((last_amount_cents - prev_amount_cents) / prev_amount_cents) * 100))` — clamped to never go negative, so a price *decrease* is simply reported as `0`/unchanged; only increases ever surface as a "price rose" signal.
- **`renewsIn` (days to next expected charge)**: `null` unless a Gmail charge exists for that merchant at all — `renewsIn = charge ? max(0, 30 - daysSince(charge.last_charge_at)) : null`. A merchant known only from an issued card (no Gmail receipt yet) always has `renewsIn === null`, even though the card has its own `created_at`. The cycle length is a **hardcoded 30-day assumption** (`CYCLE_DAYS`), not billing-cycle data from anywhere.
- **`hasActiveCard`**: `card?.status === "active"`.
- Each subscription is fed into `analyzeReal()` (see [§5](#5-the-rule-based-decision-engine)), then the list is sorted by `renewsIn` ascending (nulls sort last, via `?? 999`).
- **Backboard memories** are attached per subscription afterward via `memoriesForSubscriptions()` (see [§7](#7-backboard-memories-display)) — this never blocks or throws; a sub simply has no `memories` field if none come back.
- **Budget**: buckets the last 6 months (`date_trunc('month', now()) - interval '5 months'` onward) of classified Gmail spend by month and by `catalog.categoryFor()` category. `spent` = current month total, `lastMonth` = previous month total, `monthlyCap = lastMonth || spent` (falls back to `spent` so a brand-new user doesn't divide by zero). `saved` = sum of the price of every subscription whose `card === "closed"` (no currently-active card) — a **current-state** figure, not a historical one; prior months in the 6-month trend chart always show `saved: 0` except the current month.
- Per-category budget line `cap` = last month's real spend in that category, or this month's amount if there's no prior-month data (`cap = prevAmt > 0 ? prevAmt : spentAmt`) — never an arbitrary invented limit.
- **Transactions**: `card_transactions` joined to `issued_cards`, newest 25, `kind` is hardcoded `"out"` (no declines are recorded anywhere in the system yet).
- **Connectors**: Stripe's state is derived from whether `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID` is set (not a live Stripe call) plus a count of active `issued_cards`; Bank/Gmail/Backboard/Voice come from a single `union all` query across `gmail_connections`, `plaid_items`, `backboard_assistants`, `voice_enrollments`.

---

## 5. The rule-based decision engine

`lib/analyze-real.ts`'s `analyzeReal()` is a pure function, deliberately **not** a port of `analyze-demo.ts`'s usage-based scoring — there is no usage-tracking signal for any real service anywhere in this codebase. Every input is a real, already-persisted signal.

### Inputs

```ts
interface RealAnalysisInput {
  name: string;
  price: number;
  priceChangePct: number;   // see §4 — always >= 0
  hasActiveCard: boolean;
  renewsInDays: number | null;
  chargeCount: number;
}
```

### Constants

| Name | Value | Meaning |
|---|---|---|
| `PRICE_JUMP_THRESHOLD` | `10` | A price-change % at or above this counts as a "price rose" signal |
| `DUE_SOON_DAYS` | `7` | `renewsInDays` at or below this counts as "due soon" |

### Derived booleans

- `priceRose = priceChangePct >= 10`
- `dueSoon = renewsInDays !== null && renewsInDays <= 7`

### Decision order (first match wins — this is an `if`/`else if` chain, not independent rules)

| # | Condition | `status` | `verdict` | `tone` | Headline template |
|---|---|---|---|---|---|
| 1 | `priceRose` (regardless of card or renewal timing) | `ask` | `Review` | `hold` | *"`{name}`'s price rose `{pct}`% since your last charge — worth confirming before it renews again at $`{price}`/mo."* |
| 2 | `!priceRose && !hasActiveCard && dueSoon` | `ask` | `Review` | `hold` | *"No active card on file, and the next charge for `{name}` looks due in `{days}` day(s) — mint one to keep it renewing, or let it lapse."* |
| 3 | `!priceRose && hasActiveCard` | `renew` | `Keep` | `renew` | *"`{name}` is set to renew — a single-use card is already active for the next $`{price}` charge."* |
| 4 | else (`!priceRose && !hasActiveCard && !dueSoon`) | `hold` | `Keep` | `hold` | *"No charge for `{name}` expected soon (in `{days}` days) — nothing to decide right now."* (renewal clause omitted if `renewsInDays === null`) |

**Priority notes:**
- A price rise (rule 1) overrides everything, including an already-active card — even a subscription that's fully set up to auto-renew gets flagged `ask`/Review the moment its last charge came in ≥10% higher than the one before it.
- Rule 3 (`hasActiveCard` ⇒ `renew`/Keep) does **not** check `dueSoon` at all — a subscription with a live card renews "quietly" regardless of how soon that renewal is.
- `annual = (price * 12).toFixed(0)` is computed unconditionally for display, in every branch.

### `factors[]` construction (independent of the branch chosen above)

```
priceFactor =
  priceRose            → { good: false, text: "Price rose {pct}% since your last charge" }
  else chargeCount > 1 → { good: true,  text: "Price unchanged since your last charge" }
  else                 → { good: true,  text: "Only one charge on record — no price history yet" }

cardFactor =
  hasActiveCard → { good: true,  text: "A single-use card is already minted for the next charge" }
  else          → { good: false, text: "No active card on file right now" }
```

Rules 1 and 4 order factors `[priceFactor, cardFactor]`; rules 2 and 3 order them `[cardFactor, priceFactor]` (the factor most relevant to *why* that verdict fired is listed first).

### What it deliberately never does

`analyzeReal()` **never returns `tone: "cancel"` or `verdict: "Cancel"`** — even though `SubStatus`/`Tone`/`Verdict` all include a cancel value (used by `analyze-demo.ts`). The engine's own header comment is explicit about why: recommending cancellation is a real, consequential claim about whether a service is worth keeping, and nothing measured here (price movement, card presence, elapsed days) answers that question — only a human decision (via the popup) or a future real usage signal should.

---

## 6. "Call me" proxy

Confirmed: **the dashboard does not talk to Vapi.** It forwards to the `calling-agent` branch's own deployed API, server-to-server, reusing the shared session cookie — exactly as root `ARCHITECTURE.md` §3/§5 describes.

**Client** (`components/dashboard/CallMeButton.tsx`): a small state machine `idle → asking → calling → done | error`. In `mode="demo"` it fakes the entire sequence with `setTimeout`s and never issues a network request. In `mode="real"`, if no phone number is on hand it first shows an inline capture panel (`asking`), then `POST`s `/api/dashboard/call-me` with `{ phoneNumber, context }` where `context` is built by `summarize(subscriptions)` — a plain-text join of every subscription whose status is `ask` or `hold` as `"{name}: {reason}"` (falls back to "Nothing needs a decision right now — just checking in." when none do).

**Server** (`app/api/dashboard/call-me/route.ts`), gated by `middleware.ts` (`/api/dashboard/*`):

1. Reads the `vouch_session` cookie off the incoming request; 401s if absent.
2. Reads `CALLING_AGENT_URL` from env; if unset, returns **501** `{ error: "Voice calling isn't configured yet — see .env.example (CALLING_AGENT_URL)." }` rather than crashing (same treatment `card-issuing` got before its Stripe keys existed).
3. Validates `phoneNumber` (required, trimmed) and `context` (truncated to 2000 chars) from the JSON body.
4. Forwards: `POST {CALLING_AGENT_URL}/api/calling-agent/calls`, with header `Cookie: vouch_session=<the same token>` and body `{ toNumber: phoneNumber, purpose: "purchase_verification", context }`.
5. Translates the response: on failure, re-emits the calling-agent's `error` message with status `401` (passed through) or `502` (anything else); on success, `{ ok: true, callId: data.call.vapiCallId }`.

**Confirmed against the `calling-agent` branch's own source** (`app/api/calling-agent/calls/route.ts`, `lib/calling-agent/assistant.ts`):
- Its route calls `requireUser()` from its own `lib/session.ts`, which reads the `vouch_session` cookie the same way this branch does — verified against the same `JWT_SECRET`. No separate service-to-service auth exists; the forwarded cookie *is* the auth.
- `"purchase_verification"` is the literal value of `calling-agent`'s exported `PURCHASE_VERIFICATION_PURPOSE` constant. Since branches don't import each other's code, this branch pins the string directly (with a comment explaining why), rather than importing the constant.
- On a `purchase_verification` call, `calling-agent`'s route independently pulls the user's own top-k Backboard memories (via its own `lib/calling-agent/backboard-context.ts`) using the `context` string as the query, and folds that into the assistant's system prompt — so the same "top-k Backboard memory" pattern used for the dashboard's popup ([§7](#7-backboard-memories-display)) is repeated, separately, on the calling-agent side for the live call.

**Proxy target**: `CALLING_AGENT_URL` (env var, see [§12](#12-environment-variables)) — expected to be `https://callingagent.getvouch.club` per root `ARCHITECTURE.md`'s branch/subdomain table, confirmed against `.env.example`'s own example value.

---

## 7. Backboard memories display

The commit "Show raw Backboard memories per subscription on the dashboard" adds a **read-only** display; the write side lives entirely on `gmail-connector`.

**Write side (not this branch, referenced only):** `gmail-connector`'s `lib/gmail-sync.ts` pushes every classified receipt/renewal email into the user's own Backboard assistant as it's processed.

**Read side (`lib/backboard-memories.ts`, this branch):**
1. `getAssistantId(userId)` — `select assistant_id from backboard_assistants where user_id = $1`. Wrapped in try/catch: `backboard_assistants` is owned by `gmail-connector` and may not exist on every DB, so a query failure (not just a missing row) degrades to `null`.
2. If no assistant id (never connected Gmail) or no `BACKBOARD_API_KEY`, returns `{}` immediately.
3. Otherwise, for every subscription **in parallel**, `searchMemories(assistantId, sub.name, limit=5)` — `POST https://app.backboard.io/api/assistants/{id}/memories/search` with `{ query: sub.name, limit: 5 }`, header `X-API-Key`. A non-OK response yields `[]` for that subscription (never throws).
4. Result is keyed by subscription id, with empty-array entries filtered out entirely (`Object.fromEntries(...filter(([, m]) => m.length > 0))`).

The merchant name **is** the semantic search query — Backboard decides relevance and ordering, and the dashboard shows that ordering as-is; nothing here re-ranks, re-scores, or filters by score.

**Rendering** (`components/dashboard/CardPopup.tsx`): if `sub.memories?.length`, a "What Vouch remembers · N from Backboard" section lists each memory's `content` verbatim in a `<p>`, followed by a meta row with `score.toFixed(2)` + " match" (only if non-null), a formatted timestamp (`formatMemoryTimestamp`, UTC-pinned so server/client renders agree), and every `metadata` entry as a `key: value` tag. No summarization, truncation, or rewriting happens anywhere in this path — confirmed by both the code and the dedicated test cases in `memory-schema.test.ts` asserting content passes through "byte for byte."

Failure modes that all degrade to "no memories panel" rather than a broken page: no `BACKBOARD_API_KEY`, no Gmail connection (no `backboard_assistants` row), a Backboard outage, or a response whose shape changed. `/demo` never shows this panel — there is no memory store for seeded data.

---

## 8. Card minting

**Confirmed: the dashboard calls Stripe directly — it does not proxy to `card-issuing`.** `lib/stripe-mint.ts`'s own header comment says exactly this: it is *"a self-contained copy of the card-issuing branch's `lib/stripe.ts`, trimmed to only what the 'Mint card & renew' / 'Keep it dead' decision actions need (create + cancel)."* This is the opposite pattern from [§6](#6-call-me-proxy)'s Call Me feature (HTTP proxy) — here, card-issuing's Stripe Issuing integration code is **partially duplicated** into this branch (create-cardholder, create-card, cancel-card only — not `card-issuing`'s full freeze/unfreeze/reveal card-manager surface), each branch holding its own `stripe` SDK client keyed by its own copy of `STRIPE_SECRET_KEY`.

What it does, precisely (`mintCard(user, input)`):
1. `ensureCardholder(user, opts)` — `select stripe_cardholder_id from stripe_cardholders where user_id = $1`; if found, reuse it. If not, **require a phone number** (throws `PhoneNumberRequiredError` if absent — Stripe needs one for 3D Secure) and call `stripe.issuing.cardholders.create(...)` (hardcoded billing address `185 Berry St, San Francisco, CA 94107, US`), then `insert ... on conflict (user_id) do update` into `stripe_cardholders`.
2. `stripe.issuing.cards.create({ cardholder, currency: "usd", type: "virtual", status: "active", spending_controls: {...} if a limit was passed, financial_account_v2: <STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID> })` — the `financial_account_v2` field is cast through `Record<string, string>` since it's untyped in this SDK version (same note as `card-issuing`'s own docs).
3. Inserts a new row into `issued_cards` with `single_use = true` hardcoded.

`cancelCardByStripeId(userId, stripeCardId)` calls `stripe.issuing.cards.update(id, { status: "canceled" })` then updates the local `issued_cards` row to `status = 'canceled'`.

**Because cards land in the same `issued_cards` table and the same Stripe account as `card-issuing`, `card-issuing`'s already-deployed webhook** (`app/api/stripe/webhook/route.ts`, which only exists on the `card-issuing` branch) **still auto-cancels a card minted here the moment its first transaction posts** — Stripe's webhook configuration is account-level, not branch-level, so one handler on one branch covers cards minted from either codebase. Nothing extra needs to be deployed on `dashboard` for that lifecycle step.

Triggered from `app/api/dashboard/resolve/route.ts` (`action: "renew"` → `mintCard`; `action: "cancel"` → looks up the most recent active card for that merchant via `select ... from issued_cards where status='active' and lower(merchant)=lower($2)` then `cancelCardByStripeId`). See [§9](#9-every-api-route).

---

## 9. Every API route

Auth is enforced by **`middleware.ts`** (Edge runtime) for anything under `/dashboard` or `/api/dashboard` — it verifies the `vouch_session` JWT (via the Edge-safe `lib/session-token.ts`, no DB), and for a protected API path with no/invalid session returns a `401 {"error":"Not authenticated"}` JSON response before the route handler ever runs; for a protected page path it redirects to `PORTAL_LOGIN_URL`. `/api/auth/*` and `/api/health` are **not** in `middleware.ts`'s matcher and so are reachable unauthenticated (each does its own, lighter-weight check where relevant).

| Method & path | Auth | Request body | Response | Notes |
|---|---|---|---|---|
| `POST /api/auth/logout` | none required | — | `200 {"ok": true}` | Clears `vouch_session` (`maxAge: 0`) using this branch's own `sessionCookieOptions()`. |
| `GET /api/auth/me` | none required (returns `null` user if unauthenticated) | — | `200 {"user": {id,email,name} \| null}` | Thin wrapper over `getCurrentUser()`. |
| `POST /api/dashboard/call-me` | session cookie (middleware) **+** re-checked in-handler | `{ phoneNumber: string, context?: string }` | `200 {"ok": true, "callId": string \| null}` · `400` no phone · `401` not authenticated · `501` `CALLING_AGENT_URL` unset · `502` calling-agent request failed | Proxies to `calling-agent`; see [§6](#6-call-me-proxy). |
| `POST /api/dashboard/resolve` | session cookie (middleware) **+** `requireUser()`/`getCurrentUser()` in-handler | `{ subscriptionId: string, action: "renew"\|"cancel", merchant: string, priceCents?: number, phoneNumber?: string }` | `200 {"subscription": {"card": string, "status": "renew"\|"hold"}}` · `400` invalid body or `{error, phoneRequired: true}` · `401` not authenticated · `500` mint/cancel failed | `renew` → `mintCard`; `cancel` → look up + cancel the merchant's active card. See [§8](#8-card-minting). |
| `GET /api/health` | none | — | `200 {"ok": true, "now": timestamptz, "version": string}` · `500 {"ok": false, "error": string}` | `select now(), version()` — plain DB connectivity probe, same shape pattern as every other branch's health route. |

---

## 10. Database schema

`db/migrations/0001_users_name.sql` — this branch's **only** migration:

```sql
-- The `users` table (created in bank-connection's 0002_users.sql) never
-- had a `name` column, but card-issuing's lib/auth.ts already selects
-- `name` from it (`select id, email, name from users ...`) -- a
-- pre-existing bug there that would fail with "column users.name does not
-- exist" the moment getUserById() runs. This branch's lib/auth.ts uses the
-- same query (for cardholder name + Settings' account panel), so fixing it
-- here for real. Nullable-safe default so existing rows don't need backfill.
alter table users add column if not exists name text not null default '';
```

### Cross-branch consistency issue: duplicated migration, confirmed

`card-issuing`'s `db/migrations/0004_users_name.sql` contains the **exact same statement**:

```sql
alter table users add column if not exists name text not null default '';
```

Both migrations are functionally harmless together — `if not exists` makes the `ALTER TABLE` itself idempotent regardless of which one runs first. But because `scripts/migrate.mjs`'s tracking table keys on **filename** (`_migrations(name text primary key, ...)`), and this is one shared database, both branches' migration runners will each successfully record their own row (`0001_users_name.sql` from a `dashboard` deploy, `0004_users_name.sql` from a `card-issuing` deploy) in the *same* shared `_migrations` table — two independent, differently-numbered entries claiming credit for one already-applied change. This is exactly the pattern the task asked to flag: **two branches independently discovered and independently fixed the same missing-column bug, under different migration numbers, with no coordination mechanism between per-branch `db/migrations/` directories** — there's nothing to prevent a third branch from adding a `000N_users_name.sql` of its own later.

A secondary, smaller wrinkle noticed in passing: root `ARCHITECTURE.md`'s ownership table attributes `users`/`user_profiles` to the `portal` branch, but per this migration's own comment (and confirmed against `bank-connection`'s tree), the `CREATE TABLE users` statement actually lives in `bank-connection`'s `0002_users.sql`, not on `portal`. Not this branch's bug to fix, but worth flagging alongside the migration-numbering issue since it's the same table.

---

## 11. `lib/memory-schema.ts`

**Shape enforced** — `RetrievedMemory`:

```ts
interface RetrievedMemory {
  id: string;
  content: string;                 // Backboard's stored text, verbatim
  score: number | null;            // cosine similarity; null if Backboard omitted it
  createdAt: string | null;        // raw ISO-ish string, NOT re-parsed into a Date
  metadata: Record<string, string>; // every value flattened to a display string; never null
}
```

**Why a memory-schema concept exists on `dashboard` too, even though memory is `gmail-connector`'s domain:** this branch never *writes* memory and owns no memory tables — it only ever reads Backboard's `POST /memories/search` HTTP response and has to turn that untyped third-party JSON into something safe to render in JSX. Since branches don't share code, `dashboard` can't import `gmail-connector`'s memory types even though the two need to agree on the data's shape; it defines its own **read-side** copy of the contract instead. The file is deliberately pure — no `pg`, no `fetch`, no env var access (that I/O lives in `lib/backboard-memories.ts`) — specifically so it's unit-testable without a DB or a live Backboard account.

Key behaviors, each with a corresponding test:
- `toRetrievedMemory(raw)`: requires a non-empty string `id` and `content`; everything else degrades gracefully (`null`/`{}`) rather than rejecting the whole row.
- **Metadata float-as-string preservation**: `gmail-connector`'s own Backboard client (`lib/backboard.ts`'s `sanitizeMetadata()`, per this file's comment) stores any non-integer float as a **string**, to dodge a real Backboard bug — a `500` on any non-integer float in metadata. `normalizeMetadataValue` passes an already-stringified number straight through rather than re-parsing it back to a `number`, so e.g. `"0.8271"` stays `"0.8271"` end to end. This is explicitly the relationship the task asked about: `dashboard` reads memory records shaped by a workaround `gmail-connector` applies on write, and has to know about that workaround on the read side too, even without importing any of `gmail-connector`'s code.
- `parseMemorySearchResponse(raw, limit?)`: expects `{ memories: [...] }`; anything else (wrong shape, non-object, `null`) yields `[]`; malformed individual rows are skipped without discarding good ones; preserves Backboard's own ordering; applies a `limit` (including `0`).
- `formatMemoryTimestamp`: formats in **UTC explicitly** (`timeZone: "UTC"`) so a server render and a client render never disagree regardless of the viewer's local zone; falls through to the raw string on an unparseable date.
- `isRetrievedMemory`: a runtime type guard (used by the tests themselves) — a compile-time type alone can't catch a shape that only goes wrong on live third-party data.

---

## 12. Environment variables

Confirmed by grepping `process.env\.` across every `.ts`/`.tsx` file on the branch — the result matches `.env.example` exactly (no undocumented vars, nothing documented but unused).

| Variable | Required? | Purpose | Used in |
|---|---|---|---|
| `DATABASE_URL` | **Required** | Shared Postgres connection string (Tiger Cloud / GCP Cloud SQL) | `lib/db.ts` |
| `JWT_SECRET` | **Required** for any authenticated route | Verifies the session JWT the `portal` branch issues. Must be byte-identical to the portal's own `JWT_SECRET`, and is also the implicit trust anchor `calling-agent` uses to accept the Call Me proxy's forwarded cookie | `lib/session-token.ts` |
| `SESSION_COOKIE_DOMAIN` | Optional | Cookie domain (`.getvouch.club`) so the portal-set cookie is readable here; used only when this branch sets/clears its own cookie (logout) | `lib/session-token.ts` (`sessionCookieOptions()`) |
| `PORTAL_LOGIN_URL` | Optional (hardcoded fallback `https://login.getvouch.club/login`) | Redirect target for a signed-out visitor | `middleware.ts`, `app/dashboard/page.tsx` |
| `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Optional (same fallback) | Client-side logout redirect target. `NEXT_PUBLIC_*` vars are inlined at build time, so changing it needs a redeploy of this branch | `components/dashboard/DashboardShell.tsx` |
| `STRIPE_SECRET_KEY` | Required to mint/cancel cards | Stripe Issuing API key (test/sandbox) — same test-mode value as `card-issuing`'s Preview env | `lib/stripe-mint.ts` |
| `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID` | Required to mint/cancel cards | The Issuing financial account to draw new cards from | `lib/stripe-mint.ts`; also read (presence-only, no Stripe call) by `lib/dashboard-data.ts` to set the Stripe connector's connected/action state |
| `BACKBOARD_API_KEY` | Optional | Backboard API key, **read-only** here (search only). Same key value as `gmail-connector`'s. Unset just means no memories panel, never an error | `lib/backboard-memories.ts` |
| `CALLING_AGENT_URL` | Effectively required for "Call me" | Base URL of the `calling-agent` branch's own deployment (expected: `https://callingagent.getvouch.club`) | `app/api/dashboard/call-me/route.ts` |

Also implicitly read: `NODE_ENV` (standard Next.js/Vercel-provided, not set manually) — `lib/session-token.ts` uses `NODE_ENV === "production"` to decide the cookie's `secure` flag.

---

## 13. Testing

`vitest.config.mts`:

```ts
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: "node", include: ["**/__tests__/**/*.test.ts"] },
});
```

`environment: "node"` (not `jsdom`) — deliberately, since the only thing under test is pure data-shaping (`lib/memory-schema.ts`), so there's no DOM to stand up and none of the React/jsdom/testing-library stack that `gmail-connector`'s component tests need. No component in `components/dashboard/*` has any test coverage.

`lib/__tests__/memory-schema.test.ts` — the entire test suite, run with `npm test` (`vitest run`). Coverage, organized by the function under test:

- **`toRetrievedMemory`**: maps a realistic full Backboard row correctly; passes `content` through byte-for-byte (leading/trailing whitespace, smart quotes, newlines all preserved — explicitly asserts *no* summarizing/truncating/rewriting); preserves a stringified float in `metadata` (`"0.8271"`) rather than re-parsing it to a number; flattens numbers/booleans/arrays/nested objects in `metadata` to strings (`3 → "3"`, `true → "true"`, array/object → `JSON.stringify`); drops metadata keys whose value is `null`/`undefined`; defaults `metadata` to `{}` for every non-object input (`undefined`, `null`, a string, a number, an array); nulls a missing/`null`/non-finite `score` (`NaN`, `Infinity`) rather than guessing one; keeps `created_at` as the raw string, nulling blank/whitespace-only/non-string values; rejects a row with no usable `id` or `content` (including non-string `id`); rejects non-object input entirely (`null`, `undefined`, a string, a number, an array) without throwing.
- **`parseMemorySearchResponse`**: maps a full response and preserves Backboard's relevance ordering; skips malformed individual rows (missing fields, `null`, a bare string) without discarding the valid ones around them; applies a `limit` including `0` (empty) and a limit larger than the array (returns everything); returns `[]` for every malformed-envelope case (`{}` with no `memories` key, `memories` not an array, `null`, `undefined`, a bare string, a bare array at the top level instead of `{memories: [...]}`).
- **`formatMemoryTimestamp`**: formats consistently in UTC regardless of what the runtime's local zone would produce (including a case that would land on a different calendar day in a positive-offset zone); falls through to the original raw string for an unparseable value; passes `null` through as `null`.
- **`isRetrievedMemory`**: accepts a fully valid object and one with `null` score/createdAt and empty metadata; rejects every individual contract violation in turn (empty `id`, non-string `content`, string `score`, `NaN` score, non-string `createdAt`, `null` metadata, a non-string metadata value, `null` itself).

No test touches `lib/dashboard-data.ts`, `lib/analyze-real.ts`, `lib/stripe-mint.ts`, `lib/backboard-memories.ts`, or any API route — all DB-/network-touching logic is untested; only the pure Backboard-shape-normalization layer has coverage.

---

## Appendix: other findings worth flagging

- **`Analysis.tsx`'s expanded-row action buttons are inert in both modes.** "Keep & auto-renew", "Cancel {name}", and "Ask me at renewal" render with no `onClick` handler at all — the only place a real mint/cancel decision can actually be made is `CardPopup` (opened from Overview/Cards/Sidebar), not from the Analysis page despite its buttons implying otherwise.
- **`Settings.tsx` is 100% local `useState`**, confirmed by inspection (no `fetch` anywhere in the file) — matches the branch's own docs, which call this out explicitly rather than letting it look wired up.
- **`app/globals.css` is the one branch using hand-rolled CSS** instead of Tailwind (per root `ARCHITECTURE.md` §2, "the dashboard uses hand-written CSS inherited from the original hackathon UI") — confirmed; there is no `tailwind.config`/`@tailwind` directive anywhere on this branch.
