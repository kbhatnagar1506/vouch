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
}

export async function getUserById(userId: string): Promise<User | null> {
  const { rows } = await pool.query<User>("select id, email, name from users where id = $1", [userId]);
  return rows[0] ?? null;
}
