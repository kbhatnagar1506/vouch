-- Adapted from aaditisinghal/vouch-aaditi migrations/011_create_memory_relations.sql.
-- user_id is TEXT (not UUID) to match users.id everywhere else in this shared DB.

CREATE TABLE IF NOT EXISTS memory_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('supersedes','contradicts','derived_from','references')),
  reason TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_relations_triple_key UNIQUE (user_id, source_id, target_id, type),
  CONSTRAINT memory_relations_no_self_loop CHECK (source_id <> target_id)
);
CREATE INDEX IF NOT EXISTS memory_relations_source_idx ON memory_relations (user_id, source_id, type);
CREATE INDEX IF NOT EXISTS memory_relations_target_idx ON memory_relations (user_id, target_id, type);
