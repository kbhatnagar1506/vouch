import { NextResponse } from "next/server";
import { getVapiClient } from "@/lib/vapi";
import {
  callOverrides,
  PURCHASE_VERIFICATION_FIELDS,
  PURCHASE_VERIFICATION_PURPOSE,
} from "@/lib/calling-agent/assistant";

/**
 * Places the demo call behind the "Call me" button on the dashboard's
 * public /demo page.
 *
 * That page has no login, so this endpoint has no session either. The
 * safety property that makes that acceptable is that **the number is never
 * taken from the request**: it comes from DEMO_CALL_NUMBER and nowhere
 * else. Someone who finds this URL can make the owner's own phone ring,
 * which the rate limit below makes tedious, and can do nothing else with
 * it. Accepting a caller-supplied number here would turn a public page
 * into a free outbound dialer pointed at anyone.
 *
 * The authenticated path for real users is POST /api/calling-agent/calls,
 * which takes a number and requires a session.
 */

const RATE_LIMIT_MS = 60_000;

// Module scope, so it resets whenever a serverless instance is recycled and
// isn't shared across instances. Good enough to stop a key being mashed;
// not a real distributed limiter. The env-pinned number is what actually
// bounds the damage.
let lastCallAt = 0;

export async function POST() {
  const toNumber = process.env.DEMO_CALL_NUMBER;
  if (!toNumber) {
    return NextResponse.json(
      { error: "Demo calling isn't configured (DEMO_CALL_NUMBER is unset)." },
      { status: 501 },
    );
  }

  const now = Date.now();
  const waited = now - lastCallAt;
  if (waited < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: `Just placed a call. Try again in ${Math.ceil((RATE_LIMIT_MS - waited) / 1000)}s.` },
      { status: 429 },
    );
  }
  lastCallAt = now;

  const context =
    process.env.DEMO_CALL_CONTEXT ??
    "This month on your account: Netflix $15.49, Spotify $11.99, and ChatGPT Plus $20.00 — $47.48 total. " +
      "The one to check on: Spotify renews in 2 days on the card ending 4021.";

  try {
    const response = await getVapiClient().calls.create({
      assistantId: requiredEnv("VAPI_ASSISTANT_ID"),
      phoneNumberId: requiredEnv("VAPI_PHONE_NUMBER_ID"),
      customer: { number: toNumber, name: process.env.DEMO_CALL_NAME || undefined },
      assistantOverrides: callOverrides({
        purpose: PURCHASE_VERIFICATION_PURPOSE,
        fields: PURCHASE_VERIFICATION_FIELDS,
        customerName: process.env.DEMO_CALL_NAME ?? null,
        context,
      }),
    });
    if (!("id" in response)) {
      throw new Error("Unexpected batch response from Vapi for a single-customer call.");
    }
    return NextResponse.json({ ok: true, callId: response.id, status: response.status ?? "queued" });
  } catch (error) {
    // Let the next attempt through: the call never happened.
    lastCallAt = 0;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to place the demo call." },
      { status: 502 },
    );
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/CALLING_AGENT.md for setup.`);
  }
  return value;
}
