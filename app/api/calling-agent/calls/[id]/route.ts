import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { getCallForUser } from "@/lib/calling-agent/calls";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const call = await getCallForUser(id, user.id);
    if (!call) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ call });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to load call" }, { status: 500 });
  }
}
