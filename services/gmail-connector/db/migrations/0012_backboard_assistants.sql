-- Adapted from aaditisinghal/vouch-aaditi migrations/014_create_backboard_assistants.sql.
-- user_id is TEXT (not UUID) to match users.id everywhere else in this shared DB.
--
-- Maps each Vouch user to a Backboard (app.backboard.io) assistant, since
-- Backboard scopes its own persistent memory per-assistant. Created lazily
-- on first push, one per user, so a Backboard assistant is the tenant
-- boundary on their side the same way user_id is on ours.
CREATE TABLE IF NOT EXISTS backboard_assistants (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  assistant_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
