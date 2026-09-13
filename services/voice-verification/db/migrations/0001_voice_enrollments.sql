-- Voice enrollment + verification-attempt history.
-- `users.id` is TEXT everywhere in this shared DB (see the portal branch's
-- CLAUDE.md for why), so it's referenced the same way here.

create table if not exists voice_enrollments (
  user_id text primary key references users(id) on delete cascade,
  -- AES-256-GCM ciphertext (lib/crypto.ts) of a JSON-encoded float array —
  -- a speaker embedding is biometric data and stored encrypted at rest,
  -- the same treatment bank-connection gives Plaid access tokens.
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
