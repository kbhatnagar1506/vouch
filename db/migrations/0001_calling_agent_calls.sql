-- Calling-agent schema: outbound Vapi calls that collect/verify onboarding
-- info on Vouch's behalf. Mirrors bank-connection's pattern (see
-- docs/PLAID.md) — typed columns for what we query on, the full raw Vapi
-- payload kept in a `raw` jsonb column so nothing is thrown away as the
-- integration evolves. `user_id` is `text` (not `uuid`) to match the
-- shared `users.id` column (see the portal branch's
-- migrations/001_create_users.sql).

create extension if not exists pgcrypto;

-- One row per outbound call. Created (status='queued') before we even call
-- Vapi, so a failure to reach Vapi's API still leaves an audit trail.
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

-- Append-only raw webhook event log, for debugging/audit (mirrors
-- bank-connection's plaid_sync_runs — "why doesn't this call show XYZ yet").
create table if not exists calling_agent_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calling_agent_calls (id) on delete cascade,
  vapi_call_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists calling_agent_events_call_id_idx on calling_agent_events (call_id);
