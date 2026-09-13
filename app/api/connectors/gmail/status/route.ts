import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/session";

export async function GET() {
  try {
    const user = await requireUser();
    const result = await pool.query(
      "SELECT google_email, connected_at FROM gmail_connections WHERE user_id = $1",
      [user.id],
    );
    const row = result.rows[0];
    return NextResponse.json({
      connected: !!row,
      email: row?.google_email ?? null,
      connectedAt: row?.connected_at ?? null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
