import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

/**
 * Backs the Sidebar's "Call me" button. Proxies to the `calling-agent`
 * branch's own service (POST /api/calling-agent/calls) rather than talking
 * to Vapi directly — that branch owns the actual assistant, the Vapi/
 * ElevenLabs integration, and the call-history DB table, per this repo's
 * "one service, one branch" convention (see root CLAUDE.md). This route's
 * only job is a server-to-server forward: it re-sends the caller's own
 * session cookie so calling-agent's `requireUser()` resolves the same user
 * (both services verify the same JWT_SECRET, so this needs no separate
 * auth of its own), maps our subscription-decision context onto
 * calling-agent's `purchase_verification` preset, and translates its
 * response into what CallMeButton expects.
 *
 * Needs CALLING_AGENT_URL (see .env.example). Until it's set, this returns
 * a clear "not configured" error instead of crashing — same treatment
 * card-issuing got before its Stripe keys existed.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const callingAgentUrl = process.env.CALLING_AGENT_URL;
  if (!callingAgentUrl) {
    return NextResponse.json({ error: "Voice calling isn't configured yet — see .env.example (CALLING_AGENT_URL)." }, { status: 501 });
  }

  const body = await req.json().catch(() => null);
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const context = typeof body?.context === "string" ? body.context.slice(0, 2000) : "";
  if (!phoneNumber) {
    return NextResponse.json({ error: "A phone number is required." }, { status: 400 });
  }

  try {
    const res = await fetch(`${callingAgentUrl}/api/calling-agent/calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Server-to-server: calling-agent verifies this JWT itself against
        // the same JWT_SECRET, so no browser cookie header is involved.
        Cookie: `${SESSION_COOKIE}=${token}`,
      },
      body: JSON.stringify({
        toNumber: phoneNumber,
        // Literal value of calling-agent's PURCHASE_VERIFICATION_PURPOSE
        // (lib/calling-agent/assistant.ts on that branch) — can't import
        // it across branches, so it's pinned here as a string.
        purpose: "purchase_verification",
        context,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data?.error || "The calling agent couldn't place the call." }, { status: res.status === 401 ? 401 : 502 });
    }
    return NextResponse.json({ ok: true, callId: data?.call?.vapiCallId ?? null });
  } catch (error) {
    console.error("dashboard/call-me failed:", error);
    return NextResponse.json({ error: "Failed to reach the calling agent." }, { status: 502 });
  }
}
