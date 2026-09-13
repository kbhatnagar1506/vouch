-- Adapted from aaditisinghal/vouch-aaditi migrations/009_create_memories.sql.
-- user_id is TEXT (not UUID) to match users.id everywhere else in this shared DB.

CREATE TABLE IF NOT EXISTS memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','archived')),
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_sha256 VARCHAR(64) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
);
CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id);
CREATE INDEX IF NOT EXISTS memories_user_status_id_idx ON memories (user_id, status, id);
CREATE INDEX IF NOT EXISTS memories_user_occurred_idx ON memories (user_id, occurred_at);
CREATE INDEX IF NOT EXISTS memories_user_hash_idx ON memories (user_id, content_sha256);
CREATE INDEX IF NOT EXISTS memories_tags_idx ON memories USING GIN (tags);
CREATE INDEX IF NOT EXISTS memories_metadata_idx ON memories USING GIN (metadata);
