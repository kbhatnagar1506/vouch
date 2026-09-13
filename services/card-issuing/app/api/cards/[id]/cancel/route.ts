import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { cancelCard } from "@/lib/stripe";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const card = await cancelCard(user.id, id);
    return NextResponse.json({ card });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to cancel card:", error);
    return NextResponse.json({ error: "Failed to cancel card" }, { status: 500 });
  }
}
