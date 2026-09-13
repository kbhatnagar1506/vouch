import { NextResponse } from "next/server";
import { bindVoiceEnrollment, recordEvent, saveIdentity, userIdForInquiry } from "@/lib/persona";
import { isVerified, parseInquiry, verifyPersonaSignature, webhookEventName, webhookPayload } from "@/lib/persona-schema";

// Persona's webhook endpoint. This — not the browser callback — is the
// source of truth for verification status: the client-side onComplete and
// the hosted flow's redirect params are both attacker-controllable, so they
// only ever drive UI.
export async function POST(request: Request) {
  // MUST read the raw body before parsing. The HMAC is computed over the
  // exact bytes Persona sent; JSON.stringify(JSON.parse(body)) reorders keys
  // and drops whitespace, and the signature will never match.
  const rawBody = await request.text();

  const secret = process.env.PERSONA_WEBHOOK_SECRET;
  if (!secret) {
    // Fail closed. An unsigned-but-accepted webhook would let anyone who
    // finds this URL mark themselves verified — and verified is what lets
    // the agent spend money.
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }
  if (!verifyPersonaSignature(request.headers.get("Persona-Signature"), rawBody, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const eventName = webhookEventName(body) ?? "unknown";
  const identity = parseInquiry(webhookPayload(body));

  try {
    await recordEvent(identity?.inquiryId ?? null, eventName, body);

    // Verification events carry no session, so the inquiry id is the only
    // link back to a user — which is why the inquiry row is written at
    // creation time (see the inquiry route).
    if (identity) {
      const userId = await userIdForInquiry(identity.inquiryId);
      if (userId) {
        await saveIdentity(userId, identity);
        if (isVerified(identity.status)) {
          await bindVoiceEnrollment(userId, identity.inquiryId);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    // 500 so Persona retries — the event is logged above either way.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook handling failed" },
      { status: 500 },
    );
  }
}
