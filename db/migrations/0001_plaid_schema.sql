-- Plaid bank-connection schema.
--
-- Design: extract the fields we know we need into typed columns (for
-- indexing/querying), but always keep the full raw Plaid response in a
-- `raw` jsonb column alongside it. Plaid's response shape is the source of
-- truth; as we discover fields worth promoting to real columns, add them
-- via a new migration and backfill from `raw` rather than re-fetching.

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
