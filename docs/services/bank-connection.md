# Service: `bank-connection`

| | |
|---|---|
| **Branch** | `bank-connection` (ref: `origin/bank-connection`) |
| **Subdomain** | `bankconnection.getvouch.club` |
| **Role** | Plaid bank-account linking — a **skippable** step in onboarding |
| **Onboarding position** | `login` → `gmail` → **`bank` (skippable)** → `voice` → `dashboard` |
| **Owns (DB tables)** | `plaid_items`, `plaid_accounts`, `plaid_transactions`, `plaid_sync_runs`, and (originally) `users` |
| **Branch doc** | `docs/PLAID.md` (this branch's own setup/reference doc — used as the baseline for this write-up) |

This document was compiled by reading `docs/PLAID.md` and `CLAUDE.md` on
`origin/bank-connection` as a baseline, then verifying and deepening every
claim against the actual source (all 27 tracked files) and against the
shared `ARCHITECTURE.md` / `CLAUDE.md` on the production branch
(`origin/claude/vigilant-meitner-fxqi9c`). Discrepancies found between the
docs and the code are called out explicitly rather than smoothed over —
see especially §9 and §12.

---

## 1. Branch lineage (read this first)

`bank-connection` forked from the production branch at commit
**`7400233` — "Document Vercel auto-deploy setup"**. This is confirmed by
`git merge-base origin/bank-connection origin/claude/vigilant-meitner-fxqi9c`,
which resolves to exactly `7400233`.

Every other service branch forked later, at **`24d36dd` — "Document the
per-service branch/subdomain convention"** (2026‑09‑12 20:06 UTC, 44 minutes
after `7400233`). That commit is the one that added the entire **"Service
branches (one repo, one DB, per-service subdomain)"** section to the root
`CLAUDE.md` — the section the orchestrating `CLAUDE.md` you're reading this
from is itself built on. Practically, that means:

- `bank-connection`'s own copy of `CLAUDE.md` (reproduced in full below)
  **does not contain that section at all** — it only has `Deployment`,
  `Bank connections (Plaid)`, and `Tiger CLI`. The convention was
  *established in practice* by this branch (the root CLAUDE.md says so:
  "Convention, established with `bank-connection`"), but the **write‑up**
  of that convention landed in a commit this branch never merged.
- Concretely, this means `bank-connection` predates and never received:
  - The explicit "one long-lived branch per service, forked from
    `claude/vigilant-meitner-fxqi9c`" framing.
  - The documented `PATCH /v9/projects/:id/domains/:domain` API shortcut
    for Git Branch Domains (see §9 — this is the one with a real,
    user-facing discrepancy attached).
  - Any awareness of sibling branches (`portal`, `gmail-connector`, etc.)
    that didn't exist yet when this branch forked. Notably, **the shared
    `users` table this branch's own migration creates predates the
    `portal` branch**, which is the one that later became its canonical
    owner (see §6.3 — this is a real, load-bearing cross-branch coupling,
    not just a doc gap).
- `docs/PLAID.md` on this branch is otherwise complete and accurate for
  everything it covers — the gaps are about *later* conventions this
  branch's docs never had a chance to absorb, not about errors in what it
  does say.

---

## 2. Purpose, role, and the Skip option

`bank-connection` lets a signed-in user link a bank account via
[Plaid](https://plaid.com) Link, then stores the connected accounts and
transactions in the shared Postgres DB. It's the third step in onboarding,
and it is **explicitly skippable** — connecting a bank is not required to
proceed to voice registration.

**Where "Skip" lives:** `app/bank/page.tsx`, added in commit
`3df2bd4 "Add a Skip option to the bank-connection step"` (the tip of this
branch). The relevant JSX:

```tsx
{accounts.length === 0 && (
  <Link
    href={VOICE_REGISTER_URL}
    className="mt-3 block w-full text-center text-[13.5px] font-semibold text-slate-500 transition hover:text-slate-700"
  >
    Skip for now
  </Link>
)}
```

Mechanically:
- The "Skip for now" link only renders **while the user has zero connected
  accounts** (`accounts.length === 0`). Once at least one account is
  connected, this link disappears and is replaced by a "Continue" button
  in the same style/position (same `VOICE_REGISTER_URL` target) — so
  skipping and completing both land you in the same place, just styled
  differently (muted text link vs. filled blue button) to reflect that one
  path is the "expected" one.
- It is a **plain client-side navigation** (`next/link` `<Link>`), not an
  API call. Skipping **sets nothing in the database** — there is no
  `skipped`/`bank_connected = false` flag written anywhere. It is purely
  "leave this page without connecting anything."
- The destination is `NEXT_PUBLIC_VOICE_REGISTER_URL`, defaulting to
  `https://voice.getvouch.club/voice/register` — the same URL the
  post-connection "Continue" button uses. Skipping and connecting are
  therefore indistinguishable to the next step; `voice-verification` has
  no way to know from this alone whether a bank was connected. The only
  record of a *successful* connection is the `bank_connected` flag
  best-effort-written to the portal's `user_profiles` table (§4, step 3) —
  which is simply never touched if the user skips.
- There is no "are you sure" / re-prompt-later mechanic. If the user skips
  and later visits `bankconnection.getvouch.club` again, they see the same
  page with zero accounts and can connect or skip again.

---

## 3. File & directory structure

27 tracked files (verified via
`git ls-tree -r --name-only origin/bank-connection`):

| Path | Purpose |
|---|---|
| `.env.example` | Template for all env vars this branch needs (Plaid keys, encryption key, session/JWT config, cross-branch URLs) |
| `.gitignore` | Ignores `.env`, `node_modules/`, `.next/`, `.vercel`, build artifacts |
| `CLAUDE.md` | This branch's agent guidance — Deployment, Plaid setup pointer, Tiger CLI install (no "Service branches" section — see §1) |
| `app/api/auth/logout/route.ts` | `POST` — clears the shared session cookie |
| `app/api/auth/me/route.ts` | `GET` — returns the current user (or `null`) from the session cookie |
| `app/api/health/route.ts` | `GET` — DB connectivity check (`select now(), version()`) |
| `app/api/plaid/accounts/route.ts` | `GET` — lists the current user's connected accounts + balances + txn counts |
| `app/api/plaid/create-link-token/route.ts` | `POST` — creates a Plaid `link_token` to open Plaid Link |
| `app/api/plaid/exchange-token/route.ts` | `POST` — exchanges a Link `public_token` for an access token, stores it encrypted, runs initial sync |
| `app/api/plaid/sync/route.ts` | `POST` — manual "sync now" for one item (same code path the webhook uses) |
| `app/api/plaid/webhook/route.ts` | `POST` — Plaid's webhook receiver (signature-verified) |
| `app/bank/oauth-return/page.tsx` | Landing page for Plaid's OAuth-institution redirect flow |
| `app/bank/page.tsx` | The `/bank` onboarding screen: Connect / Skip / Continue, connected-accounts list |
| `app/layout.tsx` | Root layout — `<html>`/`<body>`, page metadata ("Vouch") |
| `app/page.tsx` | `/` — a bare DB-health-check demo page (not part of the onboarding flow) |
| `db/migrations/0001_plaid_schema.sql` | Creates `plaid_items`, `plaid_accounts`, `plaid_transactions`, `plaid_sync_runs` |
| `db/migrations/0002_users.sql` | Creates the (originally single-tenant) `users` table + FK from `plaid_items.user_id`; seeds placeholder `demo-user` |
| `docs/PLAID.md` | This branch's setup/reference doc — read as baseline for this write-up |
| `lib/auth.ts` | Re-exports session-token primitives; `getUserById` (DB lookup by session's `userId`) |
| `lib/crypto.ts` | AES-256-GCM encrypt/decrypt helpers for secrets at rest |
| `lib/db.ts` | Lazily-constructed, proxied `pg` `Pool` (shared connection pattern) |
| `lib/plaid-client-exchange.ts` | Tiny client-side helper: POST a `public_token` to `/api/plaid/exchange-token` |
| `lib/plaid-sync.ts` | `syncItemTransactions()` — the `/transactions/sync` loop, upserts accounts/transactions |
| `lib/plaid-webhook.ts` | `verifyPlaidWebhook()` — JWT signature verification per Plaid's webhook-verification spec |
| `lib/plaid.ts` | Lazily-constructed Plaid API client (`PlaidApi`), env resolution |
| `lib/session-token.ts` | Pure (no DB, Edge-safe) JWT session cookie logic — issue/verify, cookie name/options |
| `lib/session.ts` | `getCurrentUser()` / `requireUser()` — Server Component / Route Handler session access |
| `middleware.ts` | Edge middleware — gates `/bank/*` and `/api/plaid/*`, exempts webhook + oauth-return |
| `next.config.ts` | Empty Next.js config (no overrides) |
| `package-lock.json` | Locked dependency versions |
| `package.json` | Scripts + dependencies (Next 15.5, React 19, `plaid` 47.0.0, `jose`, `pg`, `react-plaid-link`) |
| `postcss.config.mjs` | Tailwind 4 PostCSS setup |
| `public/logo1.png` | Vouch wordmark logo (used on `/bank`) |
| `scripts/migrate.mjs` | Minimal migration runner — applies `db/migrations/*.sql` in order, tracked in `_migrations` |
| `tsconfig.json` | TypeScript config |

There are no test files on this branch (no `vitest` dependency in
`package.json`, unlike some sibling branches per the root `ARCHITECTURE.md`).

---

## 4. Plaid integration, end to end

### 4.1 Client setup (`lib/plaid.ts`)

```ts
function resolvePlaidEnv(): keyof typeof PlaidEnvironments {
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (env !== "sandbox" && env !== "development" && env !== "production") {
    throw new Error(`Invalid PLAID_ENV "${env}". Use sandbox, development, or production.`);
  }
  return env;
}
```

- Defaults to **`sandbox`** if `PLAID_ENV` is unset.
- Auth is via the `PLAID-CLIENT-ID` / `PLAID-SECRET` headers (standard
  Plaid Node SDK `Configuration`).
- The client (`PlaidApi` instance) is constructed **lazily** and cached on
  `global._plaidClient` — explicitly so that importing `lib/plaid.ts`
  doesn't throw during `next build`'s route analysis or in environments
  where Plaid env vars aren't set yet (same lazy-proxy pattern as
  `lib/db.ts`'s `pool`, though `plaid.ts` uses a plain lazy singleton
  rather than a `Proxy`).
- **Products requested:** only `Products.Transactions` (see
  `create-link-token/route.ts`) — no Identity, Assets, Investments, or
  Liabilities products are requested anywhere in this branch.
- **Country codes:** `CountryCode.Us` only.

### 4.2 The full flow

```
 1. Browser (/bank)
      │  POST /api/plaid/create-link-token          [requires session]
      ▼
    Plaid: linkTokenCreate()  →  { link_token }
      │
      ▼
 2. Plaid Link opens in-browser (react-plaid-link, usePlaidLink)
    user picks institution, authenticates with their bank
      │
      ▼  (Link's onSuccess callback fires client-side)
 3. Browser
      │  POST /api/plaid/exchange-token  { public_token }   [requires session]
      ▼
    Server:
      - itemPublicTokenExchange(public_token) → { access_token, item_id }
      - encryptSecret(access_token)  (AES-256-GCM, lib/crypto.ts)
      - itemGet(access_token)                   → institution_id
      - institutionsGetById(institution_id)      → institution name
      - INSERT/UPSERT into plaid_items (encrypted token, institution, raw)
      - syncItemTransactions(item_id)            → initial transactions/sync
      - best-effort: UPDATE user_profiles SET bank_connected = true
      ▼
    Response: { ok, item_id, initial_sync: { added, modified, removed } }
      │
      ▼
 4. Browser refetches GET /api/plaid/accounts, shows connected accounts
      │
      ▼  (ongoing, server-side, no browser involved)
 5. Plaid → POST /api/plaid/webhook  whenever there's something new
    (TRANSACTIONS/SYNC_UPDATES_AVAILABLE, ITEM/ERROR,
     ITEM/PENDING_EXPIRATION, ITEM/PENDING_DISCONNECT, ...)
      - verifyPlaidWebhook() checks the Plaid-Verification JWT
      - re-runs syncItemTransactions(item_id) incrementally from the
        stored cursor, or updates plaid_items.status on item errors
```

Key invariant, stated in `docs/PLAID.md` and confirmed in code: **access
tokens never reach the browser.** Only `link_token` (short-lived, scoped to
starting a Link session) and `public_token` (short-lived, single-use,
exchanged immediately server-side) ever leave the server. The permanent
access token is encrypted the moment it's obtained and only ever
decrypted server-side, inside `syncItemTransactions()`.

### 4.3 `lib/plaid-client-exchange.ts` — the client-side exchange helper

```ts
export async function exchangePublicToken(publicToken: string): Promise<{ added: number }> {
  const res = await fetch("/api/plaid/exchange-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_token: publicToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to connect account");
  return { added: data.initial_sync.added };
}

export const LINK_TOKEN_STORAGE_KEY = "plaid_link_token";
```

This one function is shared by **both** `app/bank/page.tsx`'s in-page
`onSuccess` handler and `app/bank/oauth-return/page.tsx`'s resumed-session
`onSuccess` handler — the exchange step is identical regardless of whether
Link finished in the same tab or came back through an OAuth-institution
redirect. It also exports the `localStorage` key (`plaid_link_token`) both
pages use to persist the in-flight `link_token` across the redirect.

### 4.4 Sync (`lib/plaid-sync.ts`)

`syncItemTransactions(itemId)` is the single sync entrypoint, called from
three places: `exchange-token` (initial sync), the webhook handler
(incremental, event-driven), and `POST /api/plaid/sync` (manual).

- Loads the item's `access_token_encrypted` + `transactions_cursor` from
  `plaid_items`, decrypts the token.
- Loops `plaidClient.transactionsSync({ access_token, cursor, options: {
  include_personal_finance_category: true } })` while `has_more` is true,
  each page:
  - Upserts every account in `data.accounts` into `plaid_accounts`
    (`on conflict (account_id) do update ...`).
  - Upserts `data.added` and `data.modified` transactions into
    `plaid_transactions` (`on conflict (transaction_id) do update ...`).
  - For `data.removed`, **soft-deletes**: `update plaid_transactions set
    removed = true` — rows are never hard-deleted, so a pending charge
    that later disappears (e.g. never posted) stays visible in history
    with `removed = true` rather than vanishing silently.
- After the loop, persists the new cursor onto `plaid_items` and inserts
  one `plaid_sync_runs` row recording counts and the resulting cursor (or,
  on failure, a `plaid_sync_runs` row with just the `error` text) — a
  running audit log of every sync attempt, success or failure.
- Every row in `plaid_accounts` / `plaid_transactions` keeps the complete
  raw Plaid object in a `raw jsonb` column alongside the extracted typed
  columns — nothing Plaid returns is discarded even if not yet promoted to
  a real column (this is the explicit "adapt as we learn the real response
  shape" design principle stated in `docs/PLAID.md`).

### 4.5 Webhook handling — see §11 (verification) and the route table in §5.

---

## 5. OAuth return handling (`app/bank/oauth-return/page.tsx`)

Some institutions ("OAuth institutions" — mostly outside typical US retail
banks, but Plaid recommends supporting it universally) require a full-page
redirect to their own login page rather than an embedded Plaid Link
webview. This page is the landing spot Plaid redirects back to afterward.

Mechanics:
1. `app/bank/page.tsx`, right after fetching a `link_token`, stashes it in
   `window.localStorage` under `LINK_TOKEN_STORAGE_KEY`
   (`"plaid_link_token"`) — *before* the user ever clicks "Connect", so
   it's there even if they get redirected away immediately.
2. If the chosen institution requires OAuth, Plaid Link redirects the
   whole page to the institution, then back to
   `PLAID_REDIRECT_URI` (`/bank/oauth-return`) with Plaid-appended query
   params.
3. `oauth-return/page.tsx` reads the stashed `link_token` back out of
   `localStorage` (if it's missing — e.g. a different browser/profile —
   it shows an error pointing back to `/bank`) and calls `usePlaidLink`
   again with:
   ```ts
   const { open, ready } = usePlaidLink({
     token: linkToken ?? "",
     receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined,
     onSuccess,
   });
   useEffect(() => { if (ready) open(); }, [ready, open]);
   ```
   This **resumes the same Link session** rather than starting a new one —
   `receivedRedirectUri` is what tells the Plaid Link SDK "finish the flow
   that redirected to this URL."
4. On success, it calls the same `exchangePublicToken()` helper as the
   main page (§4.3), clears the stashed token, and
   `router.replace("/bank")`.

**Auth note:** `oauth-return` is explicitly exempted from the session
middleware (`middleware.ts`'s `EXEMPT_PATHS`), with the comment "hasn't
necessarily kept cookies through a bank's redirect." The page itself calls
`exchangePublicToken()`, which hits `/api/plaid/exchange-token` — and
*that* route is **not** exempt, so it still enforces
`requireUser()`/401s if the session cookie truly didn't survive the
redirect. The page-level exemption only avoids bouncing the user to the
portal's login page before they even get a chance to complete the Link
resume; the API-level check is the real gate.

**Registration requirement:** the exact redirect URL must be registered in
**Plaid dashboard → Developers → API → Allowed redirect URIs**, and must
match `PLAID_REDIRECT_URI` exactly (Plaid does support a `*` subdomain
wildcard, e.g. `https://*.example.com/bank/oauth-return`, useful if you
don't want to re-register per preview subdomain).

---

## 6. Database schema

Both migrations run via `npm run db:migrate` →
`node --env-file=.env scripts/migrate.mjs`, which applies
`db/migrations/*.sql` in filename order inside a transaction per file,
tracked in a `_migrations` table (idempotent — already-applied files are
skipped).

### 6.1 `db/migrations/0001_plaid_schema.sql`

```sql
create extension if not exists pgcrypto;

-- One row per Plaid "Item" (a single login at one institution).
create table if not exists plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  item_id text not null unique,
  access_token_encrypted text not null,
  institution_id text,
  institution_name text,
  status text not null default 'active',
  transactions_cursor text,
  consent_expiration_time timestamptz,
  error jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plaid_items_user_id_idx on plaid_items (user_id);

-- One row per bank account under an item.
create table if not exists plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references plaid_items (item_id) on delete cascade,
  account_id text not null unique,
  name text,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plaid_accounts_item_id_idx on plaid_accounts (item_id);

-- One row per transaction. Populated incrementally via /transactions/sync.
create table if not exists plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id text not null references plaid_accounts (account_id) on delete cascade,
  transaction_id text not null unique,
  amount numeric not null,
  iso_currency_code text,
  date date not null,
  authorized_date date,
  name text,
  merchant_name text,
  category jsonb,
  payment_channel text,
  pending boolean not null default false,
  removed boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plaid_transactions_account_id_idx on plaid_transactions (account_id);
create index if not exists plaid_transactions_date_idx on plaid_transactions (date);

-- One row per /transactions/sync call, for observability/debugging.
create table if not exists plaid_sync_runs (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references plaid_items (item_id) on delete cascade,
  added_count integer not null default 0,
  modified_count integer not null default 0,
  removed_count integer not null default 0,
  cursor_after text,
  error text,
  ran_at timestamptz not null default now()
);

create index if not exists plaid_sync_runs_item_id_idx on plaid_sync_runs (item_id);
```

### 6.2 `db/migrations/0002_users.sql`

```sql
create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

insert into users (id, email, password_hash)
values ('demo-user', 'demo-user@placeholder.invalid', encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

alter table plaid_items
  add constraint plaid_items_user_id_fkey foreign key (user_id) references users (id) on delete cascade;
```

### 6.3 Is `0002_users.sql` additive to the shared `users` table? — Yes, and it's the *origin* of it

This is one of the more interesting lineage findings. `0002_users.sql`
was written (commit `ff36bd0`, "Make bank-connection multi-tenant via a
shared session cookie") **before the `portal` branch existed** — at that
point `bank-connection` was going multi-tenant ahead of there being a real
auth service, so it created its own minimal placeholder `users` table
(`id text`, `email`, `password_hash`, `created_at` — no `name` column) plus
a `demo-user` row so existing single-tenant `plaid_items` rows (from before
auth existed at all) wouldn't be orphaned by the new foreign key.

`portal`'s own migration, `migrations/001_create_users.sql`, is explicit
that it was written *around* this fact:

```sql
-- id is TEXT (not UUID) to match bank-connection's earlier users table
-- (db/migrations/0002_users.sql on that branch), which already exists on
-- the shared production DB with a foreign key from plaid_items pointing
-- at it — changing the column type retroactively isn't safe (it holds a
-- non-UUID placeholder value, 'demo-user', for data connected before this
-- table existed). Functionally identical either way: the pg driver
-- returns both TEXT and UUID columns as plain JS strings.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reconciles with a users table that may already exist from that sibling
-- migration, which predates `name` and doesn't have it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
```

So: `users.id` being `TEXT` rather than `UUID` **everywhere in this
codebase** traces directly back to this branch's early, pre-portal
decision — confirmed by the root `ARCHITECTURE.md`'s own note ("`id` is
`TEXT`, not `UUID`... see the portal branch's `migrations/001_create_users.sql`
for why"), which itself points back here.

**A real gap this surfaces:** `lib/auth.ts` on `bank-connection` queries
`select id, email, name from users where id = $1` and types `User` with a
required `name: string` field — but **this branch's own migration
(`0002_users.sql`) never adds a `name` column.** On a database where only
`bank-connection`'s migrations have run, `getUserById()` would fail with
"column \"name\" does not exist." In production this works only because
`portal`'s migration (`001_create_users.sql`, `ALTER TABLE users ADD
COLUMN IF NOT EXISTS name ...`) has also been run against the same shared
DB — i.e. `bank-connection` is implicitly dependent on a *different
branch's* migration having been applied first (or at all), despite each
branch's `docs/PLAID.md` describing `npm run db:migrate` as though this
branch is self-sufficient. Worth knowing before spinning up a fresh DB
from `bank-connection`'s migrations alone.

**Reassigning the placeholder:** per `docs/PLAID.md`, any `plaid_items` row
connected before real auth existed is owned by `demo-user` (an unusable
account — random password hash). Reassign with:
```sql
update plaid_items set user_id = '<real user id>' where user_id = 'demo-user';
```

### 6.4 Table ownership vs. `ARCHITECTURE.md`

The production branch's `ARCHITECTURE.md` §8 database-ownership table
lists `bank-connection` as owning only `plaid_items, plaid_accounts` — it
omits `plaid_transactions` and `plaid_sync_runs` (both of which do exist,
per §6.1) from that summary table. Likely just an abbreviation in that
doc's table rather than a real inconsistency, but the code creates four
tables, not two.

---

## 7. Encryption (`lib/crypto.ts`)

Confirmed: the root `ARCHITECTURE.md` states "Sensitive values are
encrypted at rest with AES-256-GCM (`lib/crypto.ts`): voice embeddings
(biometric data) and Plaid access tokens" — and this branch's code matches
exactly.

```ts
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const base64Key = process.env.ENCRYPTION_KEY;
  ...
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes ...");
  }
  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB64, authTagB64, ciphertextB64] = payload.split(":");
  ...
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
```

- Key: `ENCRYPTION_KEY` env var, 32 raw bytes base64-encoded
  (`openssl rand -base64 32`), validated to decode to exactly 32 bytes.
- Stored format: `iv:authTag:ciphertext`, each segment base64, colon-joined
  — a single `text` column value.
- **Where it's used:** exactly one call site each.
  - `encryptSecret()` — `app/api/plaid/exchange-token/route.ts`, wrapping
    the access token before the `insert ... into plaid_items` /
    `on conflict ... update` that writes `access_token_encrypted`.
  - `decryptSecret()` — `lib/plaid-sync.ts`, decrypting
    `access_token_encrypted` back out of `plaid_items` immediately before
    each `transactionsSync()` call. Never persisted decrypted, never
    logged, never returned in any API response.
- **Key management warning (from `docs/PLAID.md`, worth repeating):**
  `ENCRYPTION_KEY` must differ between environments and must never be
  committed; losing it makes every stored access token permanently
  undecryptable. Back it up outside Vercel (password manager / secrets
  vault) — `vercel env add` secrets are write-only and can never be read
  back (per `ARCHITECTURE.md` §9).

---

## 8. Every API route

| Route | Method | Auth | Request | Response | Plaid API calls |
|---|---|---|---|---|---|
| `/api/health` | GET | none | — | `{ ok, now, version }` or `{ ok: false, error }` (500) | none |
| `/api/auth/me` | GET | none (reads cookie if present) | — | `{ user: User \| null }` | none |
| `/api/auth/logout` | POST | none | — | `{ ok: true }`; clears `vouch_session` cookie (`maxAge: 0`) | none |
| `/api/plaid/create-link-token` | POST | session required (401 if not) | — | `{ link_token }` (500 on Plaid error) | `linkTokenCreate` |
| `/api/plaid/exchange-token` | POST | session required (401 if not) | `{ public_token }` | `{ ok, item_id, initial_sync: { added, modified, removed } }` | `itemPublicTokenExchange`, `itemGet`, `institutionsGetById` (conditional), plus everything `syncItemTransactions` calls |
| `/api/plaid/accounts` | GET | session required (401 if not) | — | `{ accounts: Account[] }` (joined `plaid_accounts` + `plaid_items`, with a live transaction count subquery) | none (DB read only) |
| `/api/plaid/sync` | POST | session required (401 if not); item ownership checked | `{ item_id }` | `{ ok, added, modified, removed }` or 404 `{ error: "Item not found" }` if the item doesn't exist *or* belongs to another user (deliberately identical response either way) | `transactionsSync` (via `syncItemTransactions`, looped until `has_more` is false) |
| `/api/plaid/webhook` | POST | Plaid signature verification (**not** the session cookie — see §11); exempted from session middleware | raw Plaid webhook JSON body + `Plaid-Verification` header | `{ ok: true }` (200), or 400 (missing header) / 401 (bad signature) / 500 | `webhookVerificationKeyGet` (to verify), then `transactionsSync` (via `syncItemTransactions`) for transaction webhooks |
| `/bank` (page) | GET | session required via middleware (redirects to portal login) | — | HTML page | `linkTokenCreate` (client-triggered on load, via `create-link-token`) |
| `/bank/oauth-return` (page) | GET | exempted from middleware | Plaid OAuth query params in the URL | HTML page | none directly — resumes Link, then calls `exchange-token` |

Auth enforcement happens at **two layers**: `middleware.ts` (Edge, gates
`/bank/:path*` and `/api/plaid/:path*`, with `oauth-return` and `webhook`
carved out as `EXEMPT_PATHS`) sets an `x-user-id` header as a fast-path
hint, and every route handler additionally calls `requireUser()`
(`lib/session.ts`) itself, which **re-verifies the cookie independently**
rather than trusting the header — the code comment in `middleware.ts` is
explicit that the header is "only a fast-path hint, not trusted on its
own."

`/api/plaid/sync`'s ownership check is worth calling out for its care
around user enumeration:
```ts
const { rows } = await pool.query("select 1 from plaid_items where item_id = $1 and user_id = $2", [...]);
if (rows.length === 0) {
  // Same response whether the item doesn't exist or belongs to someone
  // else — don't confirm other users' item ids exist.
  return NextResponse.json({ error: "Item not found" }, { status: 404 });
}
```

---

## 9. Vercel Git Branch Domains — binding `bankconnection.getvouch.club`

**Important discrepancy, flagged up front:** the root `CLAUDE.md`'s
"Service branches" section (added in `24d36dd`, which this branch predates
— see §1) says to "see `docs/PLAID.md` for the worked example with
`bankconnection.getvouch.club`" for the `PATCH /v9/projects/:id/domains/:domain`
API call. **This branch's `docs/PLAID.md` does not actually contain that
API call, or the string `bankconnection.getvouch.club`, anywhere.** I
grepped for `bankconnection`, `PATCH /v9`, and `gitBranch` across
`docs/PLAID.md` on *every* branch in the repo and across its full git
history — the string-literal "worked example" the root `CLAUDE.md`
promises does not exist anywhere in the repository. This is a broken/
aspirational cross-reference, not something I'm missing — it's consistent
with §1: the commit that added that promise (`24d36dd`) landed after this
branch forked, and apparently the follow-through (actually adding the
example to `docs/PLAID.md`) never happened on *any* branch.

**What `docs/PLAID.md` §6 ("Assigning your subdomain") actually says**
(reproduced verbatim, this is the real content on this branch):

> Once this branch is deployed on Vercel (it auto-deploys on push, same as
> the main branch — see below), add your subdomain as a **Domain** on the
> `vouch` Vercel project (Project Settings → Domains), pointing its CNAME
> at `cname.vercel-dns.com` per Vercel's instructions. Then update
> `PLAID_WEBHOOK_URL` to the real subdomain and re-deploy so new webhook
> registrations use it.

That's a UI-driven, generic procedure — it never names
`bankconnection.getvouch.club` specifically, and it doesn't mention the
Vercel API at all.

**The only place the actual API pattern appears** is the root `CLAUDE.md`
itself (not `docs/PLAID.md`):

```
PATCH /v9/projects/:id/domains/:domain
{"gitBranch": "<branch>"}
```

Instantiated for this branch (constructed here from that generic template
— **not itself present in `docs/PLAID.md`**, provided because it's
operationally the most useful form of this information):

```
PATCH https://api.vercel.com/v9/projects/<project-id-or-name>/domains/bankconnection.getvouch.club
Authorization: Bearer <VERCEL_TOKEN>
Content-Type: application/json

{"gitBranch": "bank-connection"}
```

where `<project-id-or-name>` is the `vouch` project (`acme-1b76/vouch`
per the root `CLAUDE.md`'s Deployment section). This binds the
already-added `bankconnection.getvouch.club` domain to auto-deploy
specifically from the `bank-connection` branch, equivalent to doing it via
Project Settings → Domains → attach a domain to a specific branch in the
dashboard.

**Full procedure for this branch, combining `docs/PLAID.md`'s deployment
steps with the domain-binding mechanism** (whether via UI or the API call
above):
1. Push to `bank-connection` — Vercel auto-builds it as a **Preview**
   deployment (this branch is not the project's Production Branch).
2. Add `bankconnection.getvouch.club` as a Domain on the `vouch` project
   (CNAME → `cname.vercel-dns.com`), then bind it to the `bank-connection`
   branch specifically — either in Project Settings → Domains, or via the
   `PATCH` call above.
3. Add `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL`,
   `PLAID_REDIRECT_URI`, `ENCRYPTION_KEY`, `JWT_SECRET`,
   `SESSION_COOKIE_DOMAIN`, and the `PORTAL_LOGIN_URL`/
   `NEXT_PUBLIC_*` URLs to the **Preview** environment (this branch's env
   vars are not inherited from Production — see §10 and the root
   `CLAUDE.md`).
4. Update `PLAID_WEBHOOK_URL` to the real, now-bound subdomain and
   redeploy, so new webhook registrations (at `linkTokenCreate` time) use
   the live URL rather than a placeholder.
5. Register the same redirect/webhook URLs in the Plaid dashboard
   (Developers → API → Allowed redirect URIs; webhook URL in the Item/
   webhook settings) — see §5 and §11.

---

## 10. Environment variables

Cross-referenced `grep -rn "process\.env\."` across every `.ts`/`.tsx`
file on this branch against `.env.example`. Every variable read in code is
documented in `.env.example`; nothing is read that isn't listed there.

| Variable | Used in | Purpose |
|---|---|---|
| `DATABASE_URL` | `lib/db.ts`, `scripts/migrate.mjs` | Shared Postgres connection string (Tiger Cloud) — same across all branches |
| `PLAID_CLIENT_ID` | `lib/plaid.ts` | Plaid API auth (`PLAID-CLIENT-ID` header) |
| `PLAID_SECRET` | `lib/plaid.ts` | Plaid API auth (`PLAID-SECRET` header); must match `PLAID_ENV` |
| `PLAID_ENV` | `lib/plaid.ts` | `sandbox` \| `development` \| `production` — selects `PlaidEnvironments` base URL; defaults to `sandbox` if unset |
| `PLAID_WEBHOOK_URL` | `app/api/plaid/create-link-token/route.ts` | Passed to `linkTokenCreate` as the webhook Plaid should call for this Item (belt-and-suspenders alongside the dashboard-configured webhook URL — Plaid uses whichever was set most recently) |
| `PLAID_REDIRECT_URI` | `app/api/plaid/create-link-token/route.ts` | Passed to `linkTokenCreate`; must exactly match a URI registered in Plaid's Allowed Redirect URIs, and point at `/bank/oauth-return`. Only needed for OAuth institutions |
| `ENCRYPTION_KEY` | `lib/crypto.ts` | 32 random bytes, base64 — AES-256-GCM key for encrypting Plaid access tokens at rest |
| `JWT_SECRET` | `lib/session-token.ts` | HS256 signing/verification secret for the `vouch_session` cookie — **must exactly match** the portal branch's `JWT_SECRET` |
| `SESSION_COOKIE_DOMAIN` | `lib/session-token.ts` | Cookie domain, `.getvouch.club`, so the session cookie is readable on every subdomain. Left unset defaults to host-only (fine for local dev) |
| `NODE_ENV` | `lib/session-token.ts` | Standard Next.js env; used only to set the cookie's `secure` flag (`true` in production) |
| `PORTAL_LOGIN_URL` | `middleware.ts` | Server-side redirect target for signed-out visitors (this branch has no login UI of its own) |
| `NEXT_PUBLIC_PORTAL_LOGIN_URL` | `app/bank/page.tsx` | Client-side equivalent of `PORTAL_LOGIN_URL`, used by the "Log out" button's post-logout redirect |
| `NEXT_PUBLIC_VOICE_REGISTER_URL` | `app/bank/page.tsx` | Next onboarding step's URL — used by both "Skip for now" and "Continue" |

Not read anywhere in code but implied by shared infra / `ARCHITECTURE.md`:
none found — this branch's env footprint is fully captured above.

Note per `ARCHITECTURE.md` §9: `NEXT_PUBLIC_*` vars are inlined at
**build** time, so changing `NEXT_PUBLIC_PORTAL_LOGIN_URL` or
`NEXT_PUBLIC_VOICE_REGISTER_URL` requires a redeploy of this branch, not
just a Vercel settings change.

---

## 11. Webhook security

`app/api/plaid/webhook/route.ts` requires a `Plaid-Verification` header on
every request (400 if missing) and calls `verifyPlaidWebhook(rawBody,
verificationJwt)` (`lib/plaid-webhook.ts`) before processing anything; a
verification failure returns 401 and the body is never parsed as trusted
input. This implements
[Plaid's webhook-verification scheme](https://plaid.com/docs/api/webhooks/webhook-verification/)
in full:

```ts
export async function verifyPlaidWebhook(rawBody: string, verificationJwt: string): Promise<void> {
  const { kid } = decodeProtectedHeader(verificationJwt);
  if (!kid) throw new Error("Plaid webhook JWT is missing a key id.");

  const jwk = await getVerificationKey(kid);              // cached per-process by kid
  const key = await importJWK(jwk, "ES256");
  const { payload } = await jwtVerify(verificationJwt, key, { maxTokenAge: `${MAX_WEBHOOK_AGE_SECONDS}s` }); // 5 min

  const expectedHash = payload.request_body_sha256;
  const actualHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (expectedHash !== actualHash) {
    throw new Error("Plaid webhook body hash mismatch.");
  }
}
```

Three checks, all required:
1. **Signature** — the JWT's `kid` selects a verification key fetched live
   from Plaid (`webhookVerificationKeyGet`, cached in-memory by `kid` for
   the life of the process — Plaid rotates keys infrequently), and the JWT
   itself is verified as ES256.
2. **Freshness** — `maxTokenAge` rejects anything older than 5 minutes
   (replay protection).
3. **Body integrity** — the JWT's `request_body_sha256` claim must match a
   fresh SHA-256 of the *raw* request body (read via `request.text()`,
   not `request.json()`, specifically so the exact bytes are hashed before
   any parsing).

**Deployment Protection vs. this specific webhook:** the root `CLAUDE.md`
warns that Preview deployments (which is what this non-production branch
gets) sit behind Vercel's SSO-based Deployment Protection by default, and
that this "blocks third-party callbacks (webhooks) unless bypassed,"
calling it "a security-relevant setting, not a default to flip silently."
**I checked specifically for how this was handled for the Plaid webhook on
this branch, and found nothing** — neither `docs/PLAID.md` nor
`CLAUDE.md` on `bank-connection` mentions Deployment Protection, an SSO
bypass token, or any equivalent at all. The only two hits for
"Deployment Protection" on this whole branch are the root `CLAUDE.md`'s
own generic sentence (copied verbatim into this branch's `CLAUDE.md`) and
one passing mention in `docs/PLAID.md` §"Deployment" that Preview
deployments "sit behind Vercel's SSO-based Deployment Protection" —
neither one says whether/how it was actually bypassed for
`bankconnection.getvouch.club`'s webhook endpoint specifically.

Practically, this means: **if Deployment Protection is left on for this
branch's Preview deployment, Plaid's webhook calls to
`https://bankconnection.getvouch.club/api/plaid/webhook` will likely be
blocked by Vercel's SSO wall before they ever reach the JWT-verification
code above**, silently breaking incremental sync (initial sync at
`exchange-token` time would still work, since that's user-driven from
inside an authenticated browser session, but nothing after that would
update until a manual `POST /api/plaid/sync`). This is a real operational
gap, not just a documentation gap — worth resolving explicitly (e.g. via a
[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
secret passed to Plaid, or promoting this branch's deployment) rather than
assuming it. The Plaid-side signature verification (above) is real and
solid — it's the layer in front of it (Vercel) that isn't accounted for
anywhere in this branch's docs.

---

## 12. Known gaps (from `docs/PLAID.md`, verified still accurate)

- **No rate limiting / abuse protection** on any API route — confirmed;
  no middleware, headers, or per-route logic addresses this anywhere in
  the branch.
- **No UI for reauthorization** when an item's status becomes
  `reauth_required` (webhook `ITEM/PENDING_EXPIRATION` or
  `ITEM/PENDING_DISCONNECT`) — confirmed; the webhook handler only writes
  `plaid_items.status = 'reauth_required'` (see the `ITEM` case in
  `app/api/plaid/webhook/route.ts`); nothing in `app/bank/page.tsx` reads
  or surfaces `item_status` beyond displaying it as plain text in the
  connected-accounts list (`{account.item_status}` is fetched via
  `/api/plaid/accounts` but not rendered — the JSX only shows institution
  name, masked account, balance, and transaction count).
- **Sandbox testing** — use Plaid's sandbox credentials (`user_good` /
  `pass_good`) with `PLAID_ENV=sandbox` before requesting production
  access.

Additional gaps surfaced by this review (not in `docs/PLAID.md`):
- The Vercel-Deployment-Protection-vs-webhook question is unresolved and
  undocumented for this branch specifically (§11).
- `lib/auth.ts`'s `getUserById` query depends on a `users.name` column
  that only `portal`'s migration adds, not this branch's own (§6.3) — a
  real migration-ordering dependency across branches sharing one DB.
- The "worked example" the root `CLAUDE.md` promises in `docs/PLAID.md`
  for Vercel Git Branch Domains doesn't exist in the repository (§9).
