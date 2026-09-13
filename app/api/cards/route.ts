import { NextRequest, NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { createVirtualCard, listCards } from "@/lib/stripe";

export async function GET() {
  try {
    const user = await requireUser();
    const cards = await listCards(user.id);
    return NextResponse.json({ cards });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to list cards:", error);
    return NextResponse.json({ error: "Failed to load cards" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    const merchant = typeof body.merchant === "string" ? body.merchant.trim() : undefined;
    const spendingLimitCents =
      typeof body.spendingLimitCents === "number" && Number.isFinite(body.spendingLimitCents)
        ? Math.round(body.spendingLimitCents)
        : undefined;

    const card = await createVirtualCard(user, { label, merchant, spendingLimitCents });
    return NextResponse.json({ card }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to create card:", error);
    return NextResponse.json({ error: "Failed to create card" }, { status: 500 });
  }
}
