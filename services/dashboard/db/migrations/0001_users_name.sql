-- The `users` table (created in bank-connection's 0002_users.sql) never
-- had a `name` column, but card-issuing's lib/auth.ts already selects
-- `name` from it (`select id, email, name from users ...`) -- a
-- pre-existing bug there that would fail with "column users.name does not
-- exist" the moment getUserById() runs. This branch's lib/auth.ts uses the
-- same query (for cardholder name + Settings' account panel), so fixing it
-- here for real. Nullable-safe default so existing rows don't need backfill.
alter table users add column if not exists name text not null default '';
