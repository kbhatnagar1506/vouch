import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ user: null });
  }

  const session = verifySession(token);
  if (!session) {
    return NextResponse.json({ user: null });
  }

  const result = await pool.query(
    "SELECT id, name, email FROM users WHERE id = $1",
    [session.userId],
  );
  const user = result.rows[0] ?? null;
  return NextResponse.json({ user });
}
