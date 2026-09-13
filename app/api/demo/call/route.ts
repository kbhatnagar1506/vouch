import { NextResponse } from "next/server";

/**
 * Backs the "Call me" button on the public /demo dashboard.
 *
 * A thin forward to the calling-agent service's own demo endpoint, for the
 * same reason /api/dashboard/call-me forwards rather than calling Vapi
 * here: that branch owns the assistant, the Vapi integration and the call
 * history (see root CLAUDE.md). Going through our own origin also avoids
 * needing CORS on the calling-agent side.
 *
 * Deliberately takes no input. The number lives in DEMO_CALL_NUMBER on the
 * calling-agent service and is never read from a request, which is what
 * keeps an unauthenticated endpoint on a public page from becoming an
 * outbound dialer pointed at arbitrary numbers.
 */
export async function POST() {
  const callingAgentUrl = process.env.CALLING_AGENT_URL;
  if (!callingAgentUrl) {
    return NextResponse.json(
      { error: "Voice calling isn't configured yet — see .env.example (CALLING_AGENT_URL)." },
      { status: 501 },
    );
  }

  try {
    const res = await fetch(`${callingAgentUrl}/api/calling-agent/demo-call`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || "The calling agent couldn't place the call." },
        { status: res.status === 429 ? 429 : 502 },
      );
    }
    return NextResponse.json({ ok: true, callId: data?.callId ?? null });
  } catch (error) {
    console.error("demo/call failed:", error);
    return NextResponse.json({ error: "Failed to reach the calling agent." }, { status: 502 });
  }
}
