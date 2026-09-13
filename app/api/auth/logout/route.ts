import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  // Must match the domain/path used when setting it, or the browser won't
  // recognize this as the same cookie to clear.
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
