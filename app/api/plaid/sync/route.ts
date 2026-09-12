import { NextResponse } from "next/server";
import { syncItemTransactions } from "@/lib/plaid-sync";

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
    const result = await syncItemTransactions(body.item_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 },
    );
  }
}
