import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  hashPassword,
  signSession,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { name, email, password } = body as {
    name?: string;
    email?: string;
    password?: string;
  };

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (!email || typeof email !== "string" || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
    normalizedEmail,
  ]);
  if (existing.rowCount && existing.rowCount > 0) {
    return NextResponse.json(
      { error: "An account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
    [name.trim(), normalizedEmail, passwordHash],
  );

  const user = result.rows[0];
  const token = signSession({ userId: user.id, email: user.email });

  const response = NextResponse.json(
    { user: { id: user.id, name: user.name, email: user.email } },
    { status: 201 },
  );
  response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions(true));
  return response;
}
