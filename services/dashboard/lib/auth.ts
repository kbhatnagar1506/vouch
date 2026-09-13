import { pool } from "@/lib/db";

export {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
  type SessionPayload,
} from "@/lib/session-token";

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  created_at: Date;
}

export async function getUserById(userId: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(
    "select id, email, name, created_at from users where id = $1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}
