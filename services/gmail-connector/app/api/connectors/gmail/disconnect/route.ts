import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { createOAuthClient } from "@/lib/google";
import { decryptSecret } from "@/lib/crypto";

export async function POST() {
  try {
    const user = await requireUser();

    const result = await pool.query("SELECT refresh_token_enc FROM gmail_connections WHERE user_id = $1", [user.id]);
    const row = result.rows[0];

    if (row) {
      try {
        const oauthClient = createOAuthClient();
        await oauthClient.revokeToken(decryptSecret(row.refresh_token_enc));
      } catch (err) {
        // Best-effort revoke; still remove our stored copy either way.
        console.error("Failed to revoke Gmail token with Google:", err);
      }
    }

    await pool.query("DELETE FROM gmail_connections WHERE user_id = $1", [user.id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Disconnect failed" }, { status: 500 });
  }
}
