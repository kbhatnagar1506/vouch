-- Adapted from aaditisinghal/vouch-aaditi migrations/004_create_gmail_messages.sql.
-- user_id is TEXT (not UUID) to match users.id everywhere else in this shared DB.

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
