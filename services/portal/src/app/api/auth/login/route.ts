import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  verifyPassword,
  signSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, rememberMe } = body as {
    email?: string;
    password?: string;
    rememberMe?: boolean;
  };
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const invalidCredentials = () =>
    NextResponse.json({ error: "Invalid email or password" }, { status: 401 });

  const result = await pool.query(
    "SELECT id, name, email, password_hash FROM users WHERE email = $1",
    [normalizedEmail],
  );
  const user = result.rows[0];
  if (!user) {
    return invalidCredentials();
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return invalidCredentials();
  }

  const token = signSession({ userId: user.id, email: user.email });
  const response = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(Boolean(rememberMe)));
  return response;
}
