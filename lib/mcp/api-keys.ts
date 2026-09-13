import { createHash, randomBytes } from "crypto";
import { pool } from "@/lib/db";

const TOKEN_PREFIX = "mcpk_";

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export interface McpApiKeySummary {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Mints a new bearer token for `userId` and stores only its hash. The raw
 * token is returned once here and never recoverable again -- same
 * treatment GitHub/Stripe give their own API keys.
 */
export async function createApiKey(userId: string, label: string): Promise<{ id: string; rawToken: string }> {
  const rawToken = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const result = await pool.query<{ id: string }>(
    `insert into mcp_api_keys (user_id, label, token_hash) values ($1, $2, $3) returning id`,
    [userId, label, hashToken(rawToken)],
  );
  return { id: result.rows[0].id, rawToken };
}

export async function listApiKeys(userId: string): Promise<McpApiKeySummary[]> {
  const result = await pool.query<{
    id: string;
    label: string;
    created_at: Date;
    last_used_at: Date | null;
    revoked_at: Date | null;
  }>(
    `select id, label, created_at, last_used_at, revoked_at from mcp_api_keys where user_id = $1 order by created_at desc`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  await pool.query(
    `update mcp_api_keys set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null`,
    [keyId, userId],
  );
}

/**
 * Verifies a raw `Authorization: Bearer <token>` value. Returns the owning
 * user's id, or null if the token is unknown/malformed/revoked. Best-effort
 * touches `last_used_at` -- never blocks or fails the caller on that update.
 */
export async function verifyApiKey(rawToken: string): Promise<{ userId: string } | null> {
  if (!rawToken.startsWith(TOKEN_PREFIX)) return null;

  const result = await pool.query<{ id: string; user_id: string }>(
    `select id, user_id from mcp_api_keys where token_hash = $1 and revoked_at is null`,
    [hashToken(rawToken)],
  );
  const row = result.rows[0];
  if (!row) return null;

  pool.query(`update mcp_api_keys set last_used_at = now() where id = $1`, [row.id]).catch(() => {});
  return { userId: row.user_id };
}
