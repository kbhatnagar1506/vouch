// Adapted from aaditisinghal/vouch-aaditi's src/lib/memory/tenant.ts
// (commit 55eedf7) — only the db import changed (named `pool` export here,
// vs. a default export there). Logic is otherwise identical.
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";

/**
 * Runs `fn` inside a transaction scoped to `userId` via the `app.user_id`
 * Postgres GUC, which the RLS policies on the memory_* tables compare against
 * (migration 0011). `set_config(..., true)` is transaction-local: clients
 * come from a pool, and a session-level setting would outlive this call and
 * greet whichever caller checks the connection out next.
 */
export async function withUserScope<T>(
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
