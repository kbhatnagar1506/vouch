import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { createCardEphemeralKey } from "@/lib/stripe";

// Hands the browser a short-lived key scoped to exactly this one card, for
// use with Stripe.js's Issuing Elements. The real PAN/CVC/expiry are
// decrypted client-side only -- this route never sees them. See
// docs/CARDS.md "PCI scope".
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const { stripeCardId, ephemeralKeySecret } = await createCardEphemeralKey(user.id, id);
    return NextResponse.json({ stripeCardId, ephemeralKeySecret });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to create card reveal key:", error);
    return NextResponse.json({ error: "Failed to prepare card reveal" }, { status: 500 });
  }
}
