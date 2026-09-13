import { NextResponse, type NextRequest } from "next/server";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { mintCard, cancelCardByStripeId, PhoneNumberRequiredError } from "@/lib/stripe-mint";

function getRequestIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "127.0.0.1";
}

/**
 * Backs the CardPopup's "Mint card & renew" / "Keep it dead" buttons for
 * real subscriptions. `renew` mints a fresh single-use card for the next
 * charge (card-issuing's webhook auto-cancels it after that one charge —
 * nothing extra to wire up here); `cancel` cancels whatever active card
 * currently exists for that merchant outright.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const { subscriptionId, action, merchant, priceCents, phoneNumber } = body ?? {};
  if (!subscriptionId || !merchant || (action !== "renew" && action !== "cancel")) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    if (action === "renew") {
      const minted = await mintCard(user, {
        label: merchant,
        merchant,
        spendingLimitCents: typeof priceCents === "number" && priceCents > 0 ? priceCents : undefined,
        phoneNumber: typeof phoneNumber === "string" ? phoneNumber : undefined,
        termsAcceptanceIp: getRequestIp(req),
      });
      return NextResponse.json({
        subscription: { card: `•••• ${minted.last4}`, status: "renew" },
      });
    }

    // cancel: find the most recent active card for this merchant and cancel it.
    const existing = await pool.query<{ stripe_card_id: string }>(
      `select stripe_card_id from issued_cards
       where user_id = $1 and status = 'active' and lower(merchant) = lower($2)
       order by created_at desc limit 1`,
      [user.id, merchant],
    );
    if (existing.rows[0]) {
      await cancelCardByStripeId(user.id, existing.rows[0].stripe_card_id);
    }
    return NextResponse.json({ subscription: { card: "closed", status: "hold" } });
  } catch (error) {
    if (error instanceof PhoneNumberRequiredError) {
      return NextResponse.json({ error: error.message, phoneRequired: true }, { status: 400 });
    }
    console.error("dashboard/resolve failed:", error);
    return NextResponse.json({ error: "Failed to resolve subscription" }, { status: 500 });
  }
}
