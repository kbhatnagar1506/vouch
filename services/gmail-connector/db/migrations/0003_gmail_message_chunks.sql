-- Adapted from aaditisinghal/vouch-aaditi migrations/005_create_gmail_message_chunks.sql.
-- No user_id column here (scoped transitively via message_id), nothing to adapt.

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
