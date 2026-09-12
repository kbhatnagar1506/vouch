// Pure JWT session-cookie logic, deliberately with NO database import —
// this file is used from middleware.ts, which runs on Next.js's Edge
// runtime and can't load `pg` (it needs Node's net/tls modules).
import { SignJWT, jwtVerify } from "jose";

function getSessionSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set. Generate one with `openssl rand -base64 32`.");
  }
  return new TextEncoder().encode(secret);
}

export const SESSION_COOKIE = "session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * Cookie options shared by every route that issues a session, so the
 * cross-subdomain contract lives in one place. Set SESSION_COOKIE_DOMAIN
 * (e.g. ".getvouch.club") so a session set by any service under the
 * portal's domain — this one or a sibling branch/service — is readable by
 * all of them; every service must also share the same AUTH_SECRET.
 */
export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    domain: process.env.SESSION_COOKIE_DOMAIN,
    maxAge: SESSION_TTL_SECONDS,
  };
}
