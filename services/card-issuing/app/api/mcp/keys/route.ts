import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { createApiKey, listApiKeys } from "@/lib/mcp/api-keys";

export async function GET() {
  try {
    const user = await requireUser();
    const keys = await listApiKeys(user.id);
    return NextResponse.json({ keys });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to list MCP keys:", error);
    return NextResponse.json({ error: "Failed to list keys" }, { status: 500 });
  }
}

// The raw token is returned exactly once, here -- it's stored only as a
// hash from this point on (see lib/mcp/api-keys.ts). Save it immediately;
// there's no way to retrieve it again, only revoke and mint a new one.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => ({}));
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : "MCP key";
    const { id, rawToken } = await createApiKey(user.id, label);
    return NextResponse.json({ id, label, token: rawToken }, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    console.error("Failed to create MCP key:", error);
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
