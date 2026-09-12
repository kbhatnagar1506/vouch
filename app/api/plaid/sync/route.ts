import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { syncItemTransactions } from "@/lib/plaid-sync";
import { requireUser, UnauthorizedError } from "@/lib/session";

// Manual "sync now" trigger — the webhook handler calls the same function
// automatically, this exists for a UI button / debugging.
export async function POST(request: Request) {
  let body: { item_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.item_id) {
    return NextResponse.json({ error: "item_id is required" }, { status: 400 });
  }

  try {
    const user = await requireUser();

    const { rows } = await pool.query("select 1 from plaid_items where item_id = $1 and user_id = $2", [
      body.item_id,
      user.id,
    ]);
    if (rows.length === 0) {
      // Same response whether the item doesn't exist or belongs to someone
      // else — don't confirm other users' item ids exist.
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    const result = await syncItemTransactions(body.item_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 },
    );
  }
}
