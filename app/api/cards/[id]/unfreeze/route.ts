import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { unfreezeCard } from "@/lib/stripe";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const card = await unfreezeCard(user.id, id);
    return NextResponse.json({ card });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to unfreeze card:", error);
    return NextResponse.json({ error: "Failed to unfreeze card" }, { status: 500 });
  }
}
