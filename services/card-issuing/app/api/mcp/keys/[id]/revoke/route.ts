import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { revokeApiKey } from "@/lib/mcp/api-keys";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    await revokeApiKey(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to revoke MCP key:", error);
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }
}
