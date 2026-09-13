// Pure JWT session-cookie logic, deliberately with NO database import —
// this file is used from middleware.ts, which runs on Next.js's Edge
// runtime and can't load `pg` (it needs Node's net/tls modules).
//
// This MUST match the portal branch's src/lib/auth.ts exactly — that's
// where sessions are actually issued (login/signup). Cookie name, JWT
// claim names, and JWT_SECRET all have to agree, or a session the portal
// sets will be invisible here. `jose` (HS256 JWT) and the portal's
// `jsonwebtoken` are interoperable — both produce/verify standard RFC 7519
// JWTs, they're just different libraries for the same format.
import { SignJWT, jwtVerify } from "jose";

function getSessionSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set. Must match the portal branch's JWT_SECRET exactly.");
  }
  return new TextEncoder().encode(secret);
}

export const SESSION_COOKIE = "vouch_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days, matches the portal

export interface SessionPayload {
  userId: string;
  email: string;
}

/** For local testing only — the portal is the real issuer in production. */
export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSessionSecret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

/**
 * Cookie options for anything this branch sets/clears itself (e.g. a local
 * "log out" action) — must match the portal's SESSION_COOKIE_DOMAIN or the
 * browser won't treat it as the same cookie.
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
