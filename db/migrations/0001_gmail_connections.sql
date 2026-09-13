-- Adapted from aaditisinghal/vouch-aaditi's feature/gmail-connector branch
-- (removed there before merge; ported here as its own service branch).
-- user_id is TEXT to match users.id everywhere else in this shared DB.

create table if not exists gmail_connections (
  user_id text primary key references users(id) on delete cascade,
  google_email text not null,
  -- AES-256-GCM ciphertext (lib/crypto.ts) — same treatment bank-connection
  -- gives Plaid tokens and voice-verification gives voice embeddings.
  access_token_enc text not null,
  refresh_token_enc text not null,
  scope text not null,
  expiry_date bigint not null,
  connected_at timestamptz not null default now()
);
