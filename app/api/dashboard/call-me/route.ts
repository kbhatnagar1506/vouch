import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/session";

const VAPI_CALL_URL = "https://api.vapi.ai/call";

/**
 * Places a real outbound call via Vapi so Vouch can read out pending
 * decisions out loud — the thing the CardPopup's voice-hint already
 * promises ("Vouch can ask you this out loud"). Needs VAPI_API_KEY,
 * VAPI_ASSISTANT_ID and VAPI_PHONE_NUMBER_ID (see .env.example); until
 * those are set this returns a clear "not configured" error instead of
 * crashing, same treatment as card-issuing before its Stripe keys existed.
 *
 * The exact request shape (assistantOverrides.variableValues for passing
 * the "what needs you" summary into the assistant's prompt) matches
 * Vapi's public Call Create API as documented, but hasn't been exercised
 * against a real account yet -- verify once real credentials are wired,
 * same as docs/CARDS.md's empirically-discovered Stripe quirks.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apiKey = process.env.VAPI_API_KEY;
  const assistantId = process.env.VAPI_ASSISTANT_ID;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!apiKey || !assistantId || !phoneNumberId) {
    return NextResponse.json({ error: "Voice calling isn't configured yet — see .env.example (VAPI_*)." }, { status: 501 });
  }

  const body = await req.json().catch(() => null);
  const phoneNumber = typeof body?.phoneNumber === "string" ? body.phoneNumber.trim() : "";
  const context = typeof body?.context === "string" ? body.context.slice(0, 2000) : "";
  if (!phoneNumber) {
    return NextResponse.json({ error: "A phone number is required." }, { status: 400 });
  }

  try {
    const vapiRes = await fetch(VAPI_CALL_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        assistantId,
        phoneNumberId,
        customer: { number: phoneNumber, name: user.name || user.email },
        assistantOverrides: {
          variableValues: { context, userName: user.name || user.email.split("@")[0] },
        },
      }),
    });

    const data = await vapiRes.json().catch(() => ({}));
    if (!vapiRes.ok) {
      return NextResponse.json({ error: data?.message || "Vapi couldn't place the call." }, { status: 502 });
    }
    return NextResponse.json({ ok: true, callId: data?.id ?? null });
  } catch (error) {
    console.error("dashboard/call-me failed:", error);
    return NextResponse.json({ error: "Failed to reach Vapi." }, { status: 502 });
  }
}
