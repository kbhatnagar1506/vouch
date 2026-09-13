# Gmail connector

Read-only Gmail OAuth connector — part of the onboarding chain
(signup/login → **Gmail** → bank → voice registration). Adapted from
`aaditisinghal/vouch-aaditi`'s `feature/gmail-connector` branch (she
removed it there before merging her login/signup work into `portal`;
ported here as its own service branch instead of losing the work).

## What changed from the original

Only the plumbing, not the logic — same OAuth flow, same scopes, same
token-refresh behavior:

- `lib/db.ts`: `import pool from "@/lib/db"` (default export) →
  `import { pool } from "@/lib/db"` (named), matching every other branch
  in this repo.
- `lib/crypto.ts`: her `encrypt`/`decrypt` (hex key) → this repo's
  `encryptSecret`/`decryptSecret` (base64 key, same `ENCRYPTION_KEY`
  bank-connection and voice-verification already use — one shared secret
  across services, not a new `TOKEN_ENCRYPTION_KEY`).
- Auth checks: her manual `verifySession(cookie)` calls in every route →
  this repo's `requireUser()`/`getCurrentUser()` (`lib/session.ts`), same
  underlying JWT contract.
- `migrations/002_create_gmail_connections.sql` (`user_id UUID`) →
  `db/migrations/0001_gmail_connections.sql` (`user_id TEXT`, matching
  `users.id` everywhere else in this shared DB).
- The connector was previously an embeddable widget inside her
  login-extend page; here it's the whole `/connect` page (this branch's
  entire purpose), with a real Gmail icon (`components/gmail-icon.tsx`)
  instead of plain text, and a "Skip for now" link so onboarding isn't
  blocked on it.
- Redirect targets updated for this repo's actual chain: success goes to
  `BANK_CONNECTION_URL` (not her `/login-extend`); failure returns to this
  branch's own `/connect?gmail_error=...` (not portal's login-extend,
  since Gmail-connector is its own service branch now, not part of
  portal).

## Setup

1. Google Cloud Console → APIs & Services → create an OAuth 2.0 Web
   application client. Authorized redirect URI:
   `https://gmail.getvouch.club/api/connectors/gmail/callback` (must match
   `NEXT_PUBLIC_APP_URL` + that path, or `GOOGLE_REDIRECT_URI` exactly).
2. Enable the Gmail API for the project.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`
   (see `.env.example`).
4. Run `npm run db:migrate`.

## Multi-tenancy

Same contract as every other service branch: reads the `vouch_session`
cookie the portal issues (HS256 JWT, `{ userId, email }`, `JWT_SECRET`
shared across services, `SESSION_COOKIE_DOMAIN=.getvouch.club`).
`middleware.ts` protects `/connect` and the read/write Gmail API routes;
`/api/connectors/gmail/{connect,callback}` are exempt from middleware and
check auth themselves (they're the OAuth handshake — a JSON 401 would
break the browser redirect).

## Deploy

Same Vercel project (`acme-1b76/vouch`), this branch bound to
`gmail.getvouch.club` via Git Branch Domains — see the base `CLAUDE.md`
"Service branches" section for the general pattern.

## Financial email pipeline

Once Gmail is connected, `syncGmailForUser()` (`lib/gmail-sync.ts`) imports
financially-relevant messages and turns each into a searchable, classified
record. Same source (`aaditisinghal/vouch-aaditi` commit `55eedf7`, "Add
Gmail financial email pipeline, memory subsystem, and Backboard sync") and
same adaptation pattern as the base connector above — `pool` named export,
`user_id TEXT` everywhere a migration there used `UUID`. Everything else,
including the pipeline logic itself, ported unchanged (verified by porting
her full Vitest suite alongside it — 156 tests passing).

Per message: `lib/gmail-query.ts` builds a Gmail search query targeting
receipts/invoices/subscriptions/billing (`FINANCIAL_MAIL_QUERY`, deliberately
excluding generic `noreply`/`support` senders that produced false positives);
`lib/gmail-body.ts` extracts plain text (decoding/stripping HTML as needed),
merchant (from the `From` header, falling back to the sender's domain when
the display name is generic), and a dollar amount (preferring one near a
"total/charged/amount" keyword when several appear); `lib/chunking.ts` splits
the body into ≤8 chunks of ~1800 chars; `lib/embeddings.ts` embeds each chunk
via Vertex AI `text-embedding-004` (768-dim) and mean-pools them into one
message-level embedding; `lib/spending-categories.ts` classifies that
embedding against three seeded category prototypes
(`active_subscription_usage`, `subscription_signup_renewal`,
`general_spending_habit`) by pgvector cosine nearest-neighbor. Results land
in `gmail_messages` / `gmail_message_chunks` / `gmail_message_classifications`
(migrations `0002`–`0005`), upserted idempotently on `(user_id,
gmail_message_id)` so a re-sync never duplicates.

**Incremental sync**: `gmail_connections.last_synced_at` (migration `0006`)
is the watermark. `POST /api/cron/gmail-sync` (Bearer-gated by
`CRON_SECRET`, fails closed if unset) loops every connected user and syncs
since their own watermark, meant to be called by a scheduled job (Vercel
Cron or equivalent) — not yet wired to an actual schedule as of this port.
The initial sync (covering the last month, capped at 300 messages) fires
once, non-fatally, from the OAuth callback right after tokens are stored.

## Memory subsystem

`lib/memory/` is a standalone, general-purpose memory store (not
Gmail-specific) that the sync pipeline happens to be the first writer into.
Ported verbatim from her `src/lib/memory/` with a single change: the
`user_id` GUC comparison in the RLS policies (migration `0011`) has no
`::uuid` cast, since `user_id` is `TEXT` here — every query in
`lib/memory/{store,search}.ts` already binds `userId` as an opaque parameter
rather than casting it, so no other line needed to change.

- **Bitemporal versioning** (`memories` + `memory_versions`, migrations
  `0007`/`0010`): every `updateMemory()` closes the current version's
  `valid_to` and opens a new one, so `getMemoryAsOf(userId, id, date)` can
  answer "what did we believe at time T" — not just what's true now.
- **Belief-revision graph** (`memory_relations`, migration `0009`):
  `supersede()`/`contradict()`/`link()` record typed edges
  (`supersedes`/`contradicts`/`derived_from`/`references`); `getLineage()`
  walks the `supersedes` chain transitively (cycle-safe) to find a memory's
  true head.
- **Hybrid search** (`lib/memory/search.ts` + `fusion.ts`): vector search
  (pgvector cosine over `memory_chunks`, migration `0008`) and lexical
  search (Postgres full-text `ts_rank_cd`) run in parallel and combine via
  Reciprocal Rank Fusion (`score = Σ weight/(k+rank)`, not raw-score
  averaging, since cosine similarity and a tsvector rank aren't on a
  comparable scale). `suppressSuperseded()` then drops any hit that another
  hit in the same result set transitively supersedes — but only within that
  result set, so a stale fact never just vanishes with nothing replacing it.
- **Tenant isolation** (`lib/memory/tenant.ts` + migration `0011`):
  `withUserScope()` sets the `app.user_id` Postgres GUC per-transaction;
  `FORCE ROW LEVEL SECURITY` on all four `memory_*` tables makes every query
  fail closed (unset GUC → `NULL` → every row filtered) even if application
  code ever forgot a `WHERE user_id = ...` clause. Defense in depth, not the
  only check.

Every classified Gmail message becomes one memory via `createMemory()`
(content-hash deduped, tagged with its spending category, `source: "gmail"`)
— `writeToMemory()` in `lib/gmail-sync.ts`, non-fatal to the rest of the
sync if it fails.

## Backboard sync

Optional: mirrors each classified message into
[Backboard](https://app.backboard.io)'s persistent memory API for
natural-language querying outside this app. Skipped entirely when
`BACKBOARD_API_KEY` is unset — sync and the local memory subsystem above
both work fully without it.

`lib/backboard.ts` is a from-scratch REST client ported verbatim, including
two Backboard bugs found and worked around during live testing against a
real account (not reproducible any other way — neither is documented or
validated client-side by Backboard):

- An unhandled 500 for memory content over 4096 **UTF-8 bytes** —
  `capContentLength()` truncates on the byte boundary (not `.length`, which
  counts UTF-16 units and undercounts any multi-byte character) and cleans
  up a trailing replacement character before appending an ellipsis.
- An unhandled 500 for any non-integer float in `metadata` (e.g. a
  `0.528` cosine similarity) — `sanitizeMetadata()` stringifies just those
  values, since integers and whole-number floats (`1.0`) are fine.

One Backboard "assistant" is created lazily per Vouch user
(`ensureBackboardAssistant()`, cached in `backboard_assistants`, migration
`0012`) since Backboard scopes memory per-assistant. `gmail_messages
.backboard_memory_id` (migration `0013`) tracks what's already been pushed,
since Backboard's own endpoint has no dedup — without it, every incremental
sync would re-push every message ever seen. Like the local memory write,
`writeToBackboard()` is non-fatal: a Backboard outage never undoes the
`gmail_messages` import or the local memory write that already succeeded.

## Environment variables

New since the base connector — see `.env.example` for the full list with
setup notes: `GOOGLE_CLOUD_PROJECT` / `GOOGLE_CLOUD_LOCATION` (Vertex AI
embeddings), `CRON_SECRET` (gates `/api/cron/gmail-sync`), `BACKBOARD_API_KEY`
(optional).

## Tests

`npm test` runs the full Vitest suite (156 tests as of this port) —
`vitest.config.mts`/`vitest.setup.ts` ported from the same commit, with
`vitest.setup.ts`'s seeded env vars renamed to match this repo's own
(`JWT_SECRET`, `ENCRYPTION_KEY` base64, not her `TOKEN_ENCRYPTION_KEY` hex).
Every ported lib/route/component has its test file ported alongside it,
adapted the same way as the source: a mock of `@/lib/db` mocks the named
`pool` export instead of a default export, a mock of `@/lib/session` stands
in for her manual `verifySession()` checks.
