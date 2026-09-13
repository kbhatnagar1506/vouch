-- Ported verbatim from aaditisinghal/vouch-aaditi migrations/007_create_gmail_message_classifications.sql.
-- No user_id column (scoped transitively via message_id), nothing to adapt.

CREATE TABLE IF NOT EXISTS gmail_message_classifications (
  message_id UUID PRIMARY KEY REFERENCES gmail_messages(id) ON DELETE CASCADE,
  category_key TEXT NOT NULL REFERENCES spending_categories(key),
  similarity REAL NOT NULL,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gmail_message_classifications_category_idx
  ON gmail_message_classifications (category_key);
