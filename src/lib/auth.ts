import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set");
}

export const SESSION_COOKIE_NAME = "vouch_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — upper bound; "remember me" controls actual cookie persistence

export type SessionPayload = {
  userId: string;
  email: string;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, JWT_SECRET as string, {
    expiresIn: SESSION_MAX_AGE_SECONDS,
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET as string) as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Cookie options shared by every route that sets the session cookie.
 * SESSION_COOKIE_DOMAIN (e.g. ".getvouch.club") makes the cookie readable
 * by every subdomain under the portal, not just whichever one set it —
 * without this, sibling services (bank-connection, etc.) on their own
 * subdomains can never see a session this app issues. Every service that
 * needs to share sessions must also use the same JWT_SECRET.
 */
export function sessionCookieOptions(rememberMe: boolean) {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    domain: process.env.SESSION_COOKIE_DOMAIN,
    // "Remember me" persists the cookie for 30 days; otherwise it's a
    // session cookie that clears when the browser closes.
    ...(rememberMe ? { maxAge: SESSION_MAX_AGE_SECONDS } : {}),
  };
}
