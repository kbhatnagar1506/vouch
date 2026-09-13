-- Adapted from aaditisinghal/vouch-aaditi migrations/012_create_memory_versions.sql.
-- user_id is TEXT (not UUID) to match users.id everywhere else in this shared DB.

CREATE TABLE IF NOT EXISTS memory_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  tags TEXT[] NOT NULL DEFAULT '{}',
  source VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  CONSTRAINT memory_versions_memory_version_key UNIQUE (memory_id, version)
);
CREATE INDEX IF NOT EXISTS memory_versions_lookup_idx ON memory_versions (user_id, memory_id, valid_from);
CREATE INDEX IF NOT EXISTS memory_versions_current_idx ON memory_versions (memory_id) WHERE valid_to IS NULL;
