-- Ported verbatim from aaditisinghal/vouch-aaditi migrations/008_add_last_synced_at_to_gmail_connections.sql.

ALTER TABLE gmail_connections
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
