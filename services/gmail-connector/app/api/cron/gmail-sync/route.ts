// Adapted from aaditisinghal/vouch-aaditi's src/app/api/cron/gmail-sync/route.ts
// (commit 55eedf7) — only the db import changed (named `pool` export here,
// vs. a default export there).
import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { syncGmailForUser, SyncResult } from "@/lib/gmail-sync";
import { monthsAgoUnixSeconds } from "@/lib/gmail-query";

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { rows } = await pool.query<{
    user_id: string;
    last_synced_at: string | null;
  }>("SELECT user_id, last_synced_at FROM gmail_connections");

  const results: Array<SyncResult | { userId: string; error: string }> = [];

  for (const row of rows) {
    const sinceUnixSeconds = row.last_synced_at
      ? Math.floor(new Date(row.last_synced_at).getTime() / 1000)
      : monthsAgoUnixSeconds(1);

    try {
      const result = await syncGmailForUser(row.user_id, {
        sinceUnixSeconds,
        maxMessages: 300,
      });
      results.push(result);
    } catch (err) {
      console.error(`Cron Gmail sync failed for user ${row.user_id}:`, err);
      results.push({
        userId: row.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ syncedUsers: results.length, results });
}
