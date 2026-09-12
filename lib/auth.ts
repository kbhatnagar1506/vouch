import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { pool } from "@/lib/db";

export {
  SESSION_COOKIE,
  createSessionToken,
  verifySessionToken,
  sessionCookieOptions,
} from "@/lib/session-token";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export interface User {
  id: string;
  email: string;
}

export async function getUserById(userId: string): Promise<User | null> {
  const { rows } = await pool.query<User>("select id, email from users where id = $1", [userId]);
  return rows[0] ?? null;
}

export async function getUserByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  const { rows } = await pool.query<User & { password_hash: string }>(
    "select id, email, password_hash from users where email = $1",
    [email],
  );
  return rows[0] ?? null;
}

export async function createUser(email: string, password: string): Promise<User> {
  const passwordHash = await hashPassword(password);
  const { rows } = await pool.query<User>(
    "insert into users (email, password_hash) values ($1, $2) returning id, email",
    [email, passwordHash],
  );
  return rows[0];
}
