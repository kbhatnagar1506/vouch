-- Adapted from aaditisinghal/vouch-aaditi migrations/013_enable_memory_rls.sql.
-- user_id is TEXT here (not UUID), so the GUC comparison has no ::uuid cast.
--
-- Row-level security backstop for the memory subsystem.
--
-- Application code always filters by user_id already; these policies are a
-- second, un-forgettable statement of the same predicate, enforced by
-- Postgres itself. FORCE is required because the app connects as the table
-- owner, and Postgres exempts owners from their own policies unless forced.
--
-- The GUC (app.user_id) is set per-transaction by withUserScope() in
-- lib/memory/tenant.ts. Unset -> current_setting(..., true) is NULL ->
-- every comparison is NULL -> every row is filtered out. Fail-closed.

ALTER TABLE memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE memories FORCE ROW LEVEL SECURITY;
CREATE POLICY memories_tenant_isolation ON memories
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_chunks_tenant_isolation ON memory_chunks
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_relations FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_relations_tenant_isolation ON memory_relations
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));

ALTER TABLE memory_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_versions_tenant_isolation ON memory_versions
  USING (user_id = current_setting('app.user_id', true))
  WITH CHECK (user_id = current_setting('app.user_id', true));
