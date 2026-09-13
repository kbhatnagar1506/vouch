-- Adapted from aaditisinghal/vouch-aaditi migrations/010_create_memory_chunks.sql.
-- user_id is TEXT (not UUID) to match users.id everywhere else in this shared DB.

CREATE TABLE IF NOT EXISTS memory_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  memory_id UUID NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  embedding VECTOR(768),
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', chunk_text)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT memory_chunks_memory_ordinal_key UNIQUE (memory_id, ordinal)
);
CREATE INDEX IF NOT EXISTS memory_chunks_memory_id_idx ON memory_chunks (memory_id);
CREATE INDEX IF NOT EXISTS memory_chunks_user_id_idx ON memory_chunks (user_id);
CREATE INDEX IF NOT EXISTS memory_chunks_search_vector_idx ON memory_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS memory_chunks_embedding_hnsw_idx ON memory_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
