# Database — Vouch

One Postgres instance. One database. Every branch — `portal` and all seven
service branches — connects with the same `DATABASE_URL` and applies its own
migrations against it. There is no per-service database and no schema
namespacing: table names themselves are the only boundary, so two branches
picking the same table name would collide for real. This has already
happened once on purpose (see [Cross-branch schema touches](#cross-branch-schema-touches)) and the
convention that prevents it by accident is discussed below.

This doc is the consolidated reference — every `CREATE TABLE`, verbatim,
from every branch, in one place. No single branch's checkout contains this
view: each only carries its own `db/migrations/` (or, on `portal`,
`migrations/`) directory.

---

## 1. How migrations run

Every branch carries its own copy of `scripts/migrate.mjs` (byte-identical
across all seven service branches; `portal`'s copy differs only in which
directory it reads from — see below). It is a minimal, dependency-free
runner:

- Applies `*.sql` files from the migrations directory **in filename-sorted
  order**.
- Tracks what's applied in a single table, **`_migrations`** — `(name text
  primary key, applied_at timestamptz)`.
- **`_migrations` is shared across every branch**, because it's the same
  table in the same database. Tracking key is the filename, so as long as no
  two branches ever name a migration file identically, one branch's applied
  migrations never re-run just because another branch's `npm run db:migrate`
  was invoked against the same `DATABASE_URL`. (bank-connection and
  card-issuing both ship a file that ends up doing the same thing — adding
  `users.name` — but under different filenames, `0002_users.sql`-adjacent
  work aside; see below.)
- Each migration runs inside its own transaction (`begin` / apply / insert
  into `_migrations` / `commit`), rolled back and re-thrown on failure — so a
  bad migration doesn't half-apply.
- No down-migrations, by design. This is meant to stay simple, not general.
- Invoked via `npm run db:migrate` → `node scripts/migrate.mjs`, reading
  `DATABASE_URL` from the environment (fails fast with a clear error if
  unset).

**`portal` is the one structural outlier.** Its copy of the runner reads
from `migrations/` at the repo root instead of `db/migrations/`, and its own
comment explains why the shared `_migrations` table is safe regardless:
applied-migration tracking is by filename, and distinct branches' migration
files never collide in practice. `portal` also uses `migrations/001_...`,
`003_...` numbering (three digits, gap at `002`) where every other branch
uses `db/migrations/0001_...` (four digits, no gaps). Functionally
identical; cosmetically inconsistent. **Migration `002` does not exist on
any branch** — it isn't missing, it was apparently never allocated;
`001_create_users.sql` and `003_create_user_profiles.sql` are portal's only
two files.

---

## 2. Table ownership map

| Owning branch | Tables |
|---|---|
| `portal` | `users`, `user_profiles` |
| `bank-connection` | `plaid_items`, `plaid_accounts`, `plaid_transactions`, `plaid_sync_runs` (+ retroactively adds the FK from `plaid_items.user_id` to `users`) |
| `gmail-connector` | `gmail_connections`, `gmail_messages`, `gmail_message_chunks`, `spending_categories`, `gmail_message_classifications`, `memories`, `memory_chunks`, `memory_relations`, `memory_versions`, `backboard_assistants` |
| `card-issuing` | `stripe_cardholders`, `issued_cards`, `card_transactions`, `mcp_api_keys` (+ adds `users.name`) |
| `dashboard` | *(no tables of its own — its one migration only adds `users.name`, redundantly; see below)* |
| `voice-verification` | `voice_enrollments`, `voice_verifications` |
| `calling-agent` | `calling_agent_calls`, `calling_agent_events` |
| `identity-verification` | `identity_verifications`, `identity_verification_events` (+ **alters** `voice_enrollments`, a table it doesn't own — see below) |

`users` itself has no single owner in practice — see §4.

---

## 3. Full schema, branch by branch

Every `CREATE TABLE` below is copied verbatim from the branch's migration
files, in the order the migrations apply.

### `portal` — `migrations/`

**`001_create_users.sql`**
```sql
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

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
```
`id` is `TEXT`, not `UUID` — deliberately, to stay compatible with
bank-connection's earlier `users` table (below), which already had a
non-UUID placeholder row (`'demo-user'`) referenced by a foreign key from
`plaid_items` on the shared production DB before this migration existed.
The `pg` driver returns both types as plain JS strings, so nothing upstream
cares.

**`003_create_user_profiles.sql`**
```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER NOT NULL,
  phone_number TEXT NOT NULL,
  address_street TEXT NOT NULL,
  address_city TEXT NOT NULL,
  address_state TEXT NOT NULL,
  address_zip TEXT NOT NULL,
  employment_status TEXT NOT NULL,
  income_range TEXT NOT NULL,
  financial_goal TEXT NOT NULL,
  bank_connected BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Nothing else in the codebase (no other branch, no route in `portal` itself
per its own file list) currently writes to `user_profiles` — it appears to
be schema laid down ahead of a "login-extend"/"signup-extend" flow
(`src/app/login-extend/`, `src/app/signup-extend/` exist as pages) that
collects this profile data. Treat as provisioned-but-not-yet-load-bearing
until confirmed otherwise in `docs/services/portal.md`.

---

### `bank-connection` — `db/migrations/`

**`0001_plaid_schema.sql`**
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
Design note carried in the migration itself: typed columns only for what's
queried/indexed on; the full raw Plaid response always kept in a `raw jsonb`
column alongside, so newly-useful fields get promoted via a later migration
+ backfill rather than a re-fetch. `bank-connection` is the branch that
**established** this "typed columns + `raw jsonb`" convention — later
branches (`calling-agent`, `identity-verification`) explicitly say they're
mirroring it.

**`0002_users.sql`**
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
This is `users`' **first** creation, chronologically — see §4 for why three
branches each carry a `CREATE TABLE IF NOT EXISTS users` and what that
means in practice. The `'demo-user'` placeholder row exists purely so the
new FK constraint doesn't orphan any `plaid_items` row written back when
`bank-connection` was single-tenant; its `password_hash` is a random value
nobody knows, so the account is unusable for login. The migration's own
comment gives the reassignment query: `update plaid_items set user_id =
'<real user id>' where user_id = 'demo-user';`.

---

### `gmail-connector` — `db/migrations/` (13 files — the largest schema in the repo)

All thirteen are explicitly ported from an earlier, unmerged branch
(`aaditisinghal/vouch-aaditi:feature/gmail-connector`) — every file's header
comment says so. `user_id` is `TEXT` throughout, to match `users.id`.

**`0001_gmail_connections.sql`**
```sql
create table if not exists gmail_connections (
  user_id text primary key references users(id) on delete cascade,
  google_email text not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  scope text not null,
  expiry_date bigint not null,
  connected_at timestamptz not null default now()
);
```
`access_token_enc` / `refresh_token_enc` are AES-256-GCM ciphertext via
`lib/crypto.ts` — same treatment as `bank-connection`'s Plaid tokens and
`voice-verification`'s voice embeddings.

**`0002_gmail_messages.sql`**
```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS gmail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id TEXT,
  subject TEXT,
  from_header TEXT,
  merchant TEXT,
  amount_cents INTEGER,
  received_at TIMESTAMPTZ,
  body_text TEXT NOT NULL,
  embedding VECTOR(768),
  chunk_count INTEGER NOT NULL DEFAULT 0,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gmail_messages_user_gmail_id_key UNIQUE (user_id, gmail_message_id)
);
CREATE INDEX IF NOT EXISTS gmail_messages_user_id_idx ON gmail_messages (user_id);
CREATE INDEX IF NOT EXISTS gmail_messages_received_at_idx ON gmail_messages (received_at);
```
First use of `pgvector` (`VECTOR(768)`, matching a 768-dim embedding model —
see `docs/services/gmail-connector.md` for which one).

**`0003_gmail_message_chunks.sql`**
```sql
CREATE TABLE IF NOT EXISTS gmail_message_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES gmail_messages(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(768) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT gmail_message_chunks_message_chunk_key UNIQUE (message_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS gmail_message_chunks_message_id_idx ON gmail_message_chunks (message_id);
```

**`0004_spending_categories.sql`**
```sql
CREATE TABLE IF NOT EXISTS spending_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  prototype_embedding VECTOR(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO spending_categories (key, label, description) VALUES
  ('active_subscription_usage', 'Subscriptions actively in use',
   'Order confirmation or usage receipt for an on-demand recurring service such as a DoorDash food delivery order, an Uber or Lyft ride receipt, an Instacart grocery delivery, or similar pay-per-use activity on a service the user is already subscribed to or regularly uses.'),
  ('subscription_signup_renewal', 'Subscription purchases, sign-ups, and renewals',
   'Billing, renewal, sign-up, upgrade, or cancellation confirmation for a recurring subscription or membership, such as Netflix, Spotify, a gym membership, a SaaS product renewal, or an annual/monthly plan charge.'),
  ('general_spending_habit', 'General spending habit monitoring',
   'Any other purchase, payment, invoice, order confirmation, or bill that reflects general spending behavior but is not itself a subscription renewal or an on-demand subscription usage receipt, such as a one-off retail purchase, utility bill, or online order.')
ON CONFLICT (key) DO NOTHING;
```
Exactly three global (not per-user) categories, seeded by the migration
itself. `subscription_signup_renewal` is the category the whole dashboard's
subscription list is built from (see `dashboard`'s
`lib/dashboard-data.ts`).

**`0005_gmail_message_classifications.sql`**
```sql
CREATE TABLE IF NOT EXISTS gmail_message_classifications (
  message_id UUID PRIMARY KEY REFERENCES gmail_messages(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL REFERENCES spending_categories(key),
  similarity REAL NOT NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gmail_message_classifications_category_idx ON gmail_message_classifications (category_key);
```

**`0006_gmail_connections_last_synced_at.sql`**
```sql
ALTER TABLE gmail_connections ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
```

**`0007_memories.sql`**
```sql
CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','archived')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_sha256 VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id);
CREATE INDEX IF NOT EXISTS memories_user_status_id_idx ON memories (user_id, status, id);
CREATE INDEX IF NOT EXISTS memories_user_occurred_idx ON memories (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS memories_user_hash_idx ON memories (user_id, content_sha256);
CREATE INDEX IF NOT EXISTS memories_tags_idx ON memories USING GIN (tags);
CREATE INDEX IF NOT EXISTS memories_metadata_idx ON memories USING GIN (metadata);
```

**`0008_memory_chunks.sql`**
```sql
CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(768),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_chunks_memory_ordinal_key UNIQUE (memory_id, ordinal)
);
CREATE INDEX IF NOT EXISTS memory_chunks_memory_id_idx ON memory_chunks (memory_id);
CREATE INDEX IF NOT EXISTS memory_chunks_user_id_idx ON memory_chunks (user_id);
CREATE INDEX IF NOT EXISTS memory_chunks_search_vector_idx ON memory_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw_idx ON memory_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
```
Hybrid search substrate: a generated `tsvector` (full-text) plus an HNSW
vector index (semantic) on the same table — `lib/memory/fusion.ts` almost
certainly combines both (confirm in `docs/services/gmail-connector.md`).

**`0009_memory_relations.sql`**
```sql
CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('supersedes','contradicts','derived_from','references')),
  reason TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_relations_triple_key UNIQUE (user_id, source_id, target_id, type),
  CONSTRAINT memory_relations_no_self_loop CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS memory_relations_source_idx ON memory_relations (user_id, source_id, type);
CREATE INDEX IF NOT EXISTS memory_relations_target_idx ON memory_relations (user_id, target_id, type);
```

**`0010_memory_versions.sql`**
```sql
CREATE TABLE IF NOT EXISTS memory_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  CONSTRAINT memory_versions_memory_version_key UNIQUE (memory_id, version)
);
CREATE INDEX IF NOT EXISTS memory_versions_lookup_idx ON memory_versions (user_id, memory_id, valid_from);
CREATE INDEX IF NOT EXISTS memory_versions_current_idx ON memory_versions (memory_id) WHERE valid_to IS NULL;
```
Bitemporal-style versioning (`valid_from`/`valid_to`, partial index for
"current" rows where `valid_to IS NULL`) — memories aren't overwritten in
place, superseding versions are appended.

**`0011_enable_memory_rls.sql`**
```sql
ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories FORCE ROW LEVEL SECURITY;
CREATE POLICY memories_tenant_isolation ON memories
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

-- (same ENABLE / FORCE / CREATE POLICY triplet repeated for
--  memory_chunks, memory_relations, memory_versions)
```
**Fail-closed by construction**: `current_setting('app.user_id', true)`
returns `NULL` when unset, and `user_id = NULL` is never true in SQL — so a
connection that forgets to set the per-transaction GUC sees *zero* rows
across all four memory tables, not everyone's. `FORCE ROW LEVEL SECURITY` is
required specifically because the app connects as the tables' owning role,
and Postgres exempts owners from their own RLS policies unless forced. The
GUC (`app.user_id`) is set per-transaction by `withUserScope()` in
`lib/memory/tenant.ts` — this is the one table group in the entire schema
with a database-enforced tenancy backstop, not just an application-level
`WHERE user_id = $1`.

**`0012_backboard_assistants.sql`**
```sql
CREATE TABLE IF NOT EXISTS backboard_assistants (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
Maps a Vouch user to a Backboard.io "assistant" — Backboard scopes its own
memory per-assistant, so this table is the tenant boundary on Backboard's
side, the same role `user_id` plays on ours. Created lazily on first push.

**`0013_gmail_messages_backboard_memory_id.sql`**
```sql
ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS backboard_memory_id TEXT;
```
Dedup marker — Backboard's `/memories` endpoint has no dedup of its own, so
without this column every incremental sync would re-push every message ever
seen and duplicate the assistant's memory count forever.

---

### `card-issuing` — `db/migrations/`

**`0001_stripe_cardholders.sql`**
```sql
create table if not exists stripe_cardholders (
  user_id text primary key references users(id) on delete cascade,
  stripe_cardholder_id text not null unique,
  created_at timestamptz not null default now()
);
```

**`0002_issued_cards.sql`**
```sql
create table if not exists issued_cards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  stripe_card_id text not null unique,
  label text not null default '',
  merchant text,
  last4 text not null,
  brand text not null,
  exp_month smallint not null,
  exp_year smallint not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'canceled')),
  spending_limit_cents integer,
  single_use boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists issued_cards_user_id_idx on issued_cards (user_id);
```
No PAN/CVC column — the migration's own comment is explicit that those are
never persisted server-side, only revealed client-side via a short-lived
Stripe ephemeral key + Stripe.js Issuing Elements. `single_use` defaults
`true`: **one disposable card per transaction is the standard issuance
model, not an opt-in** — the Stripe webhook handler auto-cancels a
single-use card the instant its first transaction posts, which is how a
subscription gets killed by construction, no manual cancel step needed.
`label`/`merchant` are deliberately not foreign-keyed to
`gmail-connector`'s tables (freeform text instead) so this branch's
migrations stay runnable against a fresh database on their own, independent
of whether `gmail-connector`'s schema exists.

**`0003_card_transactions.sql`**
```sql
create table if not exists card_transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references issued_cards(id) on delete cascade,
  stripe_transaction_id text not null unique,
  amount_cents integer not null,
  merchant_name text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists card_transactions_card_id_idx on card_transactions (card_id, occurred_at desc);
```
Populated from Stripe's `issuing_transaction.created` webhook — a local
read model so the UI never needs a live Stripe API round-trip just to show
history.

**`0004_users_name.sql`**
```sql
alter table users add column if not exists name text not null default '';
```
See §4 — this is one of three independent places `users.name` gets added.

**`0005_mcp_api_keys.sql`**
```sql
create table if not exists mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  label text not null default '',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists mcp_api_keys_user_id_idx on mcp_api_keys (user_id);
```
Bearer tokens for `card-issuing`'s MCP server — MCP clients (Claude,
OpenAI-style agents) can't carry the `vouch_session` cookie every other
route relies on, so this is a separate, simpler, revocable auth mechanism.
Only the SHA-256 hash is stored; the raw token is shown exactly once, at
creation (same principle as GitHub/Stripe API keys).

---

### `dashboard` — `db/migrations/`

**`0001_users_name.sql`**
```sql
alter table users add column if not exists name text not null default '';
```
Byte-for-byte the same statement as `card-issuing`'s `0004_users_name.sql`
(different filename, so `_migrations` tracks and applies both — harmlessly,
since `ADD COLUMN IF NOT EXISTS` is idempotent). See §4.

---

### `voice-verification` — `db/migrations/`

**`0001_voice_enrollments.sql`**
```sql
create table if not exists voice_enrollments (
  user_id text primary key references users(id) on delete cascade,
  embedding text not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists voice_verifications (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  speaker_score double precision,
  spoof_score double precision,
  passed boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists voice_verifications_user_id_idx on voice_verifications (user_id, created_at desc);
```
`embedding` is AES-256-GCM ciphertext (`lib/crypto.ts`) of a JSON-encoded
float array — biometric data, encrypted at rest, same treatment as Plaid
tokens. `voice_enrollments` gets a column bolted onto it later by a
**different branch entirely** — see next section.

---

### `identity-verification` — `db/migrations/`

**`0001_identity_verifications.sql`**
```sql
create table if not exists identity_verifications (
  user_id text primary key references users(id) on delete cascade,
  inquiry_id text not null unique,
  account_id text,
  status text not null,

  name_first text,
  name_last text,
  address_street_1 text,
  address_street_2 text,
  address_city text,
  address_subdivision text,
  address_postal_code text,
  address_country_code text,

  is_over_18 boolean,
  phone_verified boolean not null default false,
  selfie_liveness_passed boolean,
  selfie_document_similarity double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists identity_verification_events (
  id bigserial primary key,
  inquiry_id text,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists identity_verification_events_inquiry_idx
  on identity_verification_events (inquiry_id, created_at desc);

alter table voice_enrollments
  add column if not exists persona_inquiry_id text;
```

Two things worth pulling out:

**Data minimization is enforced by the schema itself, not just policy.**
The migration's own header comment is explicit: Persona's government-ID
verification returns far more than what's stored here — full birthdate,
document number, issue/expiry dates, nationality, sex, photograph URLs —
and none of it lands in this table. `is_over_18` exists specifically
*instead of* a birthdate column: the DOB is only ever needed for the age
comparison, so the comparison happens once and only the boolean answer is
kept. No document numbers, no dates of birth, no ID images, anywhere in
this schema. `inquiry_id` is the pointer back to Persona (the system of
record) if a dispute ever needs the full record.

**The last line is a real cross-branch schema write, not aspirational
documentation.** `identity-verification`'s own migration reaches into
`voice_enrollments` — a table it doesn't own, created by
`voice-verification`'s `0001_voice_enrollments.sql` — and adds
`persona_inquiry_id` to it. This is the literal mechanism behind the "voice
binding" described in the root `ARCHITECTURE.md` §6: once a Persona inquiry
is approved, its id is written onto that user's `voice_enrollments` row, so
every later speaker-match (`voice-verification`'s `/verify` /
`calling-agent`'s `detectHuman()`) inherits a government-ID check by
following that column, without either of those branches needing to know
anything about Persona. It only works if `identity-verification`'s
migration has actually been run against the shared database *after*
`voice-verification`'s — order matters here in a way `_migrations`'
filename-sort tracking doesn't enforce across branches (nothing stops
someone from migrating `identity-verification` against a fresh DB that
never had `voice-verification`'s migration applied; the `ALTER TABLE` would
simply fail with "relation voice_enrollments does not exist"). Whether the
application code that *writes* `persona_inquiry_id` on approval actually
exists yet is a question for `docs/services/identity-verification.md`, not
this file — this file only confirms the column exists at the schema level.

---

### `calling-agent` — `db/migrations/`

**`0001_calling_agent_calls.sql`**
```sql
create extension if not exists pgcrypto;

create table if not exists calling_agent_calls (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  vapi_call_id text unique,
  vapi_assistant_id text,
  to_number text not null,
  purpose text not null default 'onboarding_profile',
  intake_schema jsonb not null default '[]'::jsonb,
  status text not null default 'queued',
  ended_reason text,
  human_detection jsonb,
  transcript text,
  recording_url text,
  structured_data jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists calling_agent_calls_user_id_idx on calling_agent_calls (user_id);
create index if not exists calling_agent_calls_status_idx on calling_agent_calls (status);

create table if not exists calling_agent_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calling_agent_calls (id) on delete cascade,
  vapi_call_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);
create index if not exists calling_agent_events_call_id_idx on calling_agent_events (call_id);
```
Explicitly mirrors `bank-connection`'s typed-columns-plus-`raw`-jsonb
pattern. A call row is created with `status='queued'` **before** Vapi is
even called, specifically so a failure to reach Vapi's API still leaves an
audit trail rather than silently vanishing. `human_detection` (jsonb) is
where the post-call speaker-match result lives; `structured_data` (jsonb)
is where Vapi's extracted `{confirmed, concern_reason}` object lands.

**`0002_calling_agent_calls_context.sql`**
```sql
alter table calling_agent_calls add column if not exists context text;
```
Free-text detail specific to one call — e.g. the actual transaction being
verified for a `purchase_verification` call.

---

## 4. Cross-branch schema touches

Three separate things worth naming precisely, because they look similar
(all involve the `users` table or a table another branch owns) but aren't
the same kind of event:

1. **`users` is created independently by two branches, not shared code.**
   `bank-connection`'s `0002_users.sql` creates it first, chronologically
   (`id text`, `email`, `password_hash`, `created_at` — no `name`). `portal`
   *also* ships a `CREATE TABLE IF NOT EXISTS users`, but with `name`
   already in the column list, **plus** a standalone `ALTER TABLE users ADD
   COLUMN IF NOT EXISTS name ...` right after it, whose comment explains
   why: reconciling against a `users` table that may already exist from
   "that sibling migration" (bank-connection's) — which predates `name`.
   Both are written defensively enough (`IF NOT EXISTS` throughout) that
   running either against a database that already has the other's version
   of `users` is safe.
2. **`users.name` gets added a *third* time, independently, by two more
   branches.** `card-issuing`'s `0004_users_name.sql` and `dashboard`'s
   `0001_users_name.sql` are the identical one-line `ALTER TABLE users ADD
   COLUMN IF NOT EXISTS name text not null default ''` — each discovered,
   separately, that `lib/auth.ts`'s `getUserById()` selected a `name`
   column that didn't reliably exist yet (card-issuing's own commit
   message: "Fix missing users.name column referenced by lib/auth.ts").
   Harmless in practice (idempotent DDL, different filenames so
   `_migrations` applies both without conflict) but a clear signal that
   **the four branches that touch `users.name` were never cross-checked
   against each other** — the same fix was independently rediscovered
   three times (portal's inline reconciliation, card-issuing, dashboard).
3. **`identity-verification` alters `voice_enrollments`, a table it does
   not own**, on purpose — this is the one deliberate, load-bearing
   exception to "each branch owns its tables," and it's what makes the
   Persona-to-voiceprint binding possible. See the full explanation above.

None of this breaks anything mechanically — Postgres DDL here is
idempotent and additive throughout, and the shared `_migrations` table
means every branch's migrations still apply cleanly regardless of order,
*except* `identity-verification`'s must run after `voice-verification`'s
(§3). But it does mean **the schema's actual source of truth is "whatever
has actually been applied to the shared database," not any single branch's
migrations folder** — no one branch's `db/migrations/` fully describes the
live schema.

---

## 5. Shared conventions across every schema

- **`user_id` (or `id` on `users` itself) is `TEXT` everywhere, never
  `UUID`.** Established by `bank-connection` for compatibility with the
  pre-existing `'demo-user'` placeholder value, then followed by every
  later branch specifically to match `users.id`. Every migration file that
  introduces a new `user_id`-bearing table says so in a comment.
- **Encryption at rest for anything sensitive**, via a shared
  `lib/crypto.ts` (AES-256-GCM, `iv:authTag:ciphertext` all base64-encoded)
  copied byte-for-byte into every branch that needs it (only the error
  message and doc-link in the "ENCRYPTION_KEY is not set" throw differ
  branch to branch). Applies to: Plaid access tokens
  (`bank-connection`), Gmail OAuth tokens (`gmail-connector`), voice
  embeddings (`voice-verification`). All of these branches — plus
  `calling-agent` and `card-issuing`, which carry the same file only to
  *decrypt* what another branch wrote — must share the exact same
  `ENCRYPTION_KEY` value, or ciphertext written by one becomes unreadable
  by another.
- **`raw jsonb not null default '{}'::jsonb`** on any table backed by a
  third-party API response (Plaid items/accounts/transactions, calling-agent
  calls). The typed columns are a queryable projection; the jsonb column is
  the actual source of truth, so a new typed column is always a migration +
  backfill, never a re-fetch.
- **Append-only raw event/webhook logs** as a recurring pattern:
  `plaid_sync_runs` (bank-connection), `calling_agent_events`
  (calling-agent), `identity_verification_events`
  (identity-verification) all exist for the same reason — when a
  third-party integration misbehaves, the raw payload is the only thing
  that settles what actually happened.
- **Row-Level Security is the exception, not the rule** — only the four
  `gmail-connector` memory tables have it. Every other table relies on
  application-level `WHERE user_id = $1` filtering with no database-enforced
  backstop.

---

## 6. Which database is this, actually?

The root `CLAUDE.md` and `ARCHITECTURE.md` describe the shared database two
different ways, and the branches' own `.env.example` templates split
three ways — worth being precise about rather than picking one and
hiding the conflict:

| Branch | `.env.example` `DATABASE_URL` host pattern |
|---|---|
| `portal`, `bank-connection`, `voice-verification`, `claude/vigilant-meitner-fxqi9c` (production) | Tiger Cloud / Timescale — `tsdbadmin@<id>.tsdb.cloud.timescale.com:30488/tsdb` |
| `card-issuing`, `gmail-connector` | GCP Cloud SQL — `vouchapp@<cloud-sql-ip>:5432/vouch?...&uselibpqcompat=true` |
| `calling-agent`, `dashboard`, `identity-verification` | Generic placeholder — `user:password@host:5432/dbname` (never filled in with a real host) |

The root `ARCHITECTURE.md` (written most recently, at the tip of
production) states the database is "Postgres 18 on GCP Cloud SQL (instance
`vouch-db`, `us-central1`)". The root `CLAUDE.md`, by contrast, is almost
entirely Tiger CLI install/setup instructions for Tiger Cloud — and Tiger
Cloud's `DATABASE_URL` was scaffolded into the very first commits of this
repo, before any service branch existed, which is why `portal` and
`bank-connection` (among the earliest branches) still carry that
connection-string shape in their example file.

Reading the commit history in order, the most coherent explanation is:
the project started on Tiger Cloud, then at some point the real database
was provisioned on GCP Cloud SQL instead — and only the two branches with
the most live-testing history against a real database
(`card-issuing`: "Fix real Stripe Issuing requirements found via live
testing"; `gmail-connector`: needs a working DB to sync real Gmail data)
had their `.env.example` actually updated to match. The other branches'
example files are simply stale from initial scaffolding — `.env.example`
is a template, not a live value, and nothing forces it to be kept in sync
once a branch stops being actively iterated on. Since Vercel secrets are
**write-only** (`vercel env add` — see `docs/DEPLOYMENT.md` §5), there is
no way to confirm from this repository alone which `DATABASE_URL` is
actually configured against each branch's live Vercel deployment today.
**Treat `ARCHITECTURE.md`'s "GCP Cloud SQL" as the operative answer**
(it's the most recently written statement, from someone who had reason to
check), but verify directly against the Vercel project's environment
variables before relying on either claim for anything operational — and
update the five stale `.env.example` files at the same time, since they'll
otherwise keep contradicting each other for anyone reading branch by
branch instead of centrally, as this document does.

---

## 7. Related docs

- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — Vercel project, per-branch
  subdomains, env var provisioning mechanics.
- [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) — every environment variable
  across every branch, including which ones must be byte-identical
  across branches (`JWT_SECRET`, `ENCRYPTION_KEY`).
- [`docs/BRANCHES.md`](./BRANCHES.md) — the git branching model these
  schemas live on top of.
- `docs/services/*.md` — one deep-dive per branch, covering the
  application code that reads/writes each table above.
