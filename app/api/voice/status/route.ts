import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { pool } from "@/lib/db";

export async function GET() {
  try {
    const user = await requireUser();
    const { rows } = await pool.query<{ created_at: string; model_version: string }>(
      "select created_at, model_version from voice_enrollments where user_id = $1",
      [user.id],
    );
    const enrollment = rows[0];
    return NextResponse.json({
      enrolled: Boolean(enrollment),
      enrolledAt: enrollment?.created_at ?? null,
      modelVersion: enrollment?.model_version ?? null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
