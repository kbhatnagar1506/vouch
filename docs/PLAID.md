# Bank connections (Plaid)

This branch (`bank-connection`) adds bank-account linking via
[Plaid](https://plaid.com), storing connected accounts and transactions in
Postgres/TimescaleDB alongside the rest of the app.

## How it works

1. The frontend (`/bank`) requests a **link token** from
   `POST /api/plaid/create-link-token` and opens Plaid Link with it.
2. The user picks their institution and logs in inside Plaid Link. On
   success, Plaid hands the frontend a **public token**.
3. The frontend sends that to `POST /api/plaid/exchange-token`, which:
   - exchanges it for a permanent **access token** (via
     `itemPublicTokenExchange`),
   - encrypts the access token (AES-256-GCM, `lib/crypto.ts`) and stores it
     in `plaid_items`,
   - fetches institution info (`itemGet`, `institutionsGetById`),
   - runs an initial `transactions/sync` to pull whatever history Plaid
     returns (see `lib/plaid-sync.ts`).
4. From then on, Plaid calls `POST /api/plaid/webhook` whenever there's
   something new (`TRANSACTIONS: SYNC_UPDATES_AVAILABLE`, item errors,
   reauth needed, etc.), and the handler re-runs the sync incrementally
   using the stored cursor — no polling.
5. `GET /api/plaid/accounts` and the `/bank` page show what's connected.

Access tokens are **never** sent to the browser — only `link_token` and
`public_token` (both short-lived and single-purpose) leave the server.

## Data model

See `db/migrations/0001_plaid_schema.sql`. The approach: extract the fields
we know we'll query on into real columns, but keep the complete raw Plaid
response in a `raw jsonb` column on every table (`plaid_items`,
`plaid_accounts`, `plaid_transactions`). Nothing Plaid sends us is thrown
away, even if we haven't built a column for it yet — if a report later
needs a field we didn't extract, it's already in `raw` and a follow-up
migration can promote it to a proper column and backfill from there. That's
the "adapt as we learn the real response shape" part.

Tables:
- **`plaid_items`** — one row per bank login (a Plaid "Item"): encrypted
  access token, institution, sync cursor, status.
- **`plaid_accounts`** — one row per account under an item: balances, type,
  mask.
- **`plaid_transactions`** — one row per transaction, deduplicated on
  Plaid's `transaction_id`. Rows aren't hard-deleted when Plaid reports a
  transaction removed (e.g. a pending charge that never posted) — they're
  flagged `removed = true` instead, so nothing disappears silently.
- **`plaid_sync_runs`** — one row per `/transactions/sync` call, for
  debugging ("why don't I see this transaction yet").

If transaction volume grows large enough to matter, `plaid_transactions` is
a natural candidate for a TimescaleDB hypertable partitioned on `date` —
not done by default here since it adds a constraint wrinkle (the unique
constraint on `transaction_id` would need `date` folded in, and a
transaction's `date` can shift slightly between pending and posted).

## Setup

### 1. Get Plaid API keys

Sign up at https://dashboard.plaid.com, then grab your `client_id` and
`sandbox` secret from https://dashboard.plaid.com/team/keys.

### 2. Set environment variables

Locally (`.env`) and in Vercel (Project Settings → Environment Variables —
or `vercel env add <NAME> production`):

| Variable | Value |
|---|---|
| `PLAID_CLIENT_ID` | from the Plaid dashboard |
| `PLAID_SECRET` | from the Plaid dashboard (matches `PLAID_ENV`) |
| `PLAID_ENV` | `sandbox`, `development`, or `production` |
| `PLAID_WEBHOOK_URL` | `https://<your-domain>/api/plaid/webhook` |
| `PLAID_REDIRECT_URI` | `https://<your-domain>/bank/oauth-return` (OAuth institutions only — see below) |
| `ENCRYPTION_KEY` | 32 random bytes, base64: `openssl rand -base64 32` |
| `DATABASE_URL` | already set for the rest of the app |

**`ENCRYPTION_KEY` must differ between environments and must never be
committed.** Losing it means every stored access token becomes
undecryptable (and unusable) — back it up somewhere safe (a password
manager / secrets vault), not just in Vercel.

### 3. Run the migration

```sh
npm run db:migrate
```

This applies `db/migrations/0001_plaid_schema.sql` (tracked in a
`_migrations` table, safe to re-run).

### 4. Register the OAuth redirect URI (if you'll support OAuth institutions)

Some institutions require a full-page redirect instead of an embedded login
(most US banks don't, but it's worth setting up once). `app/bank/oauth-return`
is that landing page — it resumes the same Link session
(`receivedRedirectUri`) and finishes the connection the same way as a normal
in-page success.

Add the exact URL to **Plaid dashboard → Developers → API → Allowed redirect
URIs**, and set `PLAID_REDIRECT_URI` to the same value. They must match
exactly (Plaid does support a `*` wildcard for subdomains, e.g.
`https://*.example.com/bank/oauth-return`, if you're deploying multiple
preview subdomains and don't want to re-register each one).

### 5. Register the webhook URL

In the Plaid dashboard, set your webhook URL to
`https://<your-domain>/api/plaid/webhook` (also passed at link-token
creation via `PLAID_WEBHOOK_URL`, which is belt-and-suspenders — Plaid uses
whichever was set most recently for the Item).

### 6. Assigning your subdomain

Once this branch is deployed on Vercel (it auto-deploys on push, same as
the main branch — see below), add your subdomain as a **Domain** on the
`vouch` Vercel project (Project Settings → Domains), pointing its CNAME at
`cname.vercel-dns.com` per Vercel's instructions. Then update
`PLAID_WEBHOOK_URL` to the real subdomain and re-deploy so new webhook
registrations use it.

## Deployment

This branch deploys the same way the rest of the app does: push to
`bank-connection` and Vercel builds it automatically (Git integration is
already connected — see the root `CLAUDE.md`). Since `bank-connection`
isn't the project's configured **production branch**, pushes here create
**Preview** deployments by default, which sit behind Vercel's
SSO-based Deployment Protection. To serve this on a real subdomain:
- either promote a deployment from this branch with `vercel deploy --prod`,
  or
- change the Vercel project's Production Branch to `bank-connection` (or
  merge it into the current production branch), or
- assign your subdomain directly to this branch via Vercel's
  **Git Branch Domains** (Project Settings → Domains → attach a domain to
  a specific branch) — this is usually the right choice for a feature
  under active development.

Whichever path, remember to add `PLAID_CLIENT_ID`, `PLAID_SECRET`,
`PLAID_ENV`, `PLAID_WEBHOOK_URL`, and `ENCRYPTION_KEY` to that
deployment's environment (Preview and/or Production, matching whichever
you use) — they aren't inherited from the main branch's env if you're using
a different environment scope.

## Multi-tenancy

Every Plaid route requires a logged-in user and scopes its data by
`plaid_items.user_id` — no more hardcoded `demo-user`. There is **no
login/signup UI on this branch**: sign-in is owned by the portal (a sibling
service on the same parent domain, e.g. `getvouch.club`), built separately.
This branch only needs to *recognize* a session the portal already created.

**The contract** (defined in `lib/session-token.ts`; canonical source is
the `portal` branch's `src/lib/auth.ts` — this branch only verifies, it
doesn't issue):
- A cookie named `vouch_session`, set with `domain: SESSION_COOKIE_DOMAIN`
  (`.getvouch.club`) so it's readable by every subdomain, not just the one
  that set it.
- Its value is an HS256 JWT signed with `JWT_SECRET` — **the exact same
  secret value must be set in every service's environment** that needs to
  share sessions (portal uses `jsonwebtoken`, this branch verifies with
  `jose`; both are standard RFC 7519 JWT, fully interoperable). Payload:
  `{ userId, email }`.
- `userId` is `users.id` (`TEXT`, not `UUID` — see the portal branch's
  `migrations/001_create_users.sql` for why) in the shared `users` table.
  `plaid_items.user_id` references that same table.

This branch used to ship its own `/api/auth/{signup,login}` as a
placeholder — removed once the real portal branch existed, since running
two divergent auth implementations against the same `users` table invites
drift. `logout` and `me` remain (they only read/clear the shared cookie,
they don't issue sessions, so there's nothing to diverge).

**Migrating existing single-tenant data:** `0002_users.sql` (this branch)
creates a placeholder `demo-user` account (unusable — its password hash is
random) so any `plaid_items` row connected before auth existed doesn't get
orphaned by the foreign key. Reassign it to a real user with:
```sql
update plaid_items set user_id = '<real user id>' where user_id = 'demo-user';
```

**`user_profiles.bank_connected`**: `exchange-token` sets this to `true`
on the portal's `user_profiles` table after a successful connection —
best-effort (silently no-ops if that table doesn't exist yet, e.g. the
portal's migration hasn't run against this DB, or the user hasn't
completed onboarding yet so has no `user_profiles` row to update).

## Known gaps / before this is truly multi-user production

- **No rate limiting / abuse protection** on the API routes.
- **No UI for reauthorization** when an item's status becomes
  `reauth_required` (Plaid webhook `PENDING_EXPIRATION` /
  `PENDING_DISCONNECT`) — currently just recorded in `plaid_items.status`.
- Sandbox testing: use Plaid's sandbox credentials
  (`user_good` / `pass_good`) with `PLAID_ENV=sandbox` before requesting
  production access from Plaid.
