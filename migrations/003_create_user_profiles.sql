-- user_id is TEXT to match users.id (see 001_create_users.sql).
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
