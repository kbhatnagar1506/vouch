import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { verifyWebhookSignature, recordCardTransaction } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Signature verification needs the exact raw bytes Stripe signed --
  // req.json() would re-serialize and break it.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "issuing_transaction.created": {
        const txn = event.data.object as Stripe.Issuing.Transaction;
        const { autoCanceled } = await recordCardTransaction({
          stripeCardId: typeof txn.card === "string" ? txn.card : txn.card.id,
          stripeTransactionId: txn.id,
          // Stripe's issuing amounts are negative for a capture/spend.
          amountCents: Math.abs(txn.amount),
          merchantName: txn.merchant_data?.name ?? null,
          occurredAt: new Date(txn.created * 1000),
        });
        if (autoCanceled) {
          console.log(`[stripe webhook] single-use card auto-canceled after transaction ${txn.id}`);
        }
        break;
      }
      // Stripe auto-approves an authorization against the cardholder's
      // available balance/limits when this event isn't explicitly handled
      // within its response-time window -- that default is fine for now.
      // Handling it here would let us approve/decline in real time (e.g.
      // block anything but the one expected merchant on a single-use
      // card), which is a natural next step, not yet built.
      case "issuing_authorization.request":
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(`Stripe webhook handling failed for ${event.type}:`, err);
    // Still 200 -- Stripe would otherwise retry an event whose failure is
    // on our side (e.g. a transient DB error) potentially forever, and
    // recordCardTransaction's own ON CONFLICT DO NOTHING keeps retries safe.
  }

  return NextResponse.json({ received: true });
}
