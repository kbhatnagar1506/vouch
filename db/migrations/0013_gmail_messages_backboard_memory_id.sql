-- Ported verbatim from aaditisinghal/vouch-aaditi migrations/015_add_backboard_memory_id_to_gmail_messages.sql.
--
-- Tracks whether a message has already been pushed to Backboard, since
-- Backboard's own /memories endpoint has no dedup of its own -- without this,
-- every daily incremental sync would re-push every message ever seen and
-- duplicate the assistant's memory count forever.
ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS backboard_memory_id TEXT;
