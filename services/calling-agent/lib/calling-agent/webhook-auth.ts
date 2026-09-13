import { timingSafeEqual } from "crypto";

// Vapi's current API dropped the old inline `server.secret` field (it's
// now a centrally-managed `credentialId`, which isn't yet exposed as a
// typed resource in @vapi-ai/server-sdk — see docs/CALLING_AGENT.md). A
// plain custom header on `server.headers` (set in lib/calling-agent/assistant.ts)
// gives the same guarantee — Vapi echoes configured headers on every
// request it sends us — and stays entirely code-settable, no dashboard step.
export const WEBHOOK_SECRET_HEADER = "x-calling-agent-secret";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/CALLING_AGENT.md for setup.`);
  }
  return value;
}

/** True only if the request carries our shared secret in WEBHOOK_SECRET_HEADER. */
export function verifyWebhookSecret(request: Request): boolean {
  const expected = Buffer.from(requiredEnv("CALLING_AGENT_WEBHOOK_SECRET"));
  const actual = Buffer.from(request.headers.get(WEBHOOK_SECRET_HEADER) ?? "");
  // timingSafeEqual throws on length mismatch rather than returning false,
  // so the length check has to happen first (and itself leaks only length,
  // not content).
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
