import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verifyPlaidWebhook } from "@/lib/plaid-webhook";
import { syncItemTransactions } from "@/lib/plaid-sync";

interface PlaidWebhookBody {
  webhook_type: string;
  webhook_code: string;
  item_id: string;
  error?: unknown;
  [key: string]: unknown;
}

// Plaid webhook endpoint. Register this URL (https://<your-domain>/api/plaid/webhook)
// as PLAID_WEBHOOK_URL / in the Plaid dashboard. See docs/PLAID.md.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const verificationJwt = request.headers.get("plaid-verification");

  if (!verificationJwt) {
    return NextResponse.json({ error: "Missing Plaid-Verification header" }, { status: 400 });
  }

  try {
    await verifyPlaidWebhook(rawBody, verificationJwt);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook verification failed" },
      { status: 401 },
    );
  }

  const body = JSON.parse(rawBody) as PlaidWebhookBody;

  try {
    switch (body.webhook_type) {
      case "TRANSACTIONS": {
        if (body.webhook_code === "SYNC_UPDATES_AVAILABLE" || body.webhook_code === "INITIAL_UPDATE" || body.webhook_code === "HISTORICAL_UPDATE") {
          await syncItemTransactions(body.item_id);
        }
        break;
      }
      case "ITEM": {
        if (body.webhook_code === "ERROR") {
          await pool.query(
            `update plaid_items set status = 'error', error = $2, updated_at = now() where item_id = $1`,
            [body.item_id, JSON.stringify(body.error ?? {})],
          );
        } else if (body.webhook_code === "PENDING_EXPIRATION" || body.webhook_code === "PENDING_DISCONNECT") {
          await pool.query(
            `update plaid_items set status = 'reauth_required', updated_at = now() where item_id = $1`,
            [body.item_id],
          );
        }
        break;
      }
      default:
        // Unhandled webhook types are logged in raw form for later triage.
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook handling failed" },
      { status: 500 },
    );
  }
}
