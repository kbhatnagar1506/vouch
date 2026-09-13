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

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
