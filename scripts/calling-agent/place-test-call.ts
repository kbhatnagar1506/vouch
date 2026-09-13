// Places a one-off outbound call straight through Vapi's API — bypasses
// our app's DB/session/webhook entirely. For smoke-testing the assistant
// (voice/model/prompt) before wiring the full product flow (which needs a
// public deployment for webhooks — see docs/CALLING_AGENT.md).
//
//   npm run calling-agent:test-call -- --to +14155551234 [--purpose purchase_verification] [--context "..."]
import { VapiClient } from "@vapi-ai/server-sdk";
import {
  callOverrides,
  DEFAULT_INTAKE_FIELDS,
  DEFAULT_PURPOSE,
  PURCHASE_VERIFICATION_FIELDS,
  PURCHASE_VERIFICATION_PURPOSE,
} from "../../lib/calling-agent/assistant";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. See docs/CALLING_AGENT.md for setup.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const to = arg("to");
  if (!to) {
    console.error('Usage: npm run calling-agent:test-call -- --to +1XXXXXXXXXX [--purpose purchase_verification] [--context "..."]');
    process.exit(1);
  }
  const purpose = arg("purpose") ?? DEFAULT_PURPOSE;
  const context = arg("context") ?? null;
  const fields = purpose === PURCHASE_VERIFICATION_PURPOSE ? PURCHASE_VERIFICATION_FIELDS : DEFAULT_INTAKE_FIELDS;

  const vapi = new VapiClient({ token: requiredEnv("VAPI_API_KEY") });
  const assistantId = requiredEnv("VAPI_ASSISTANT_ID");
  const phoneNumberId = requiredEnv("VAPI_PHONE_NUMBER_ID");

  console.log(`Calling ${to} (purpose: ${purpose})...`);
  const created = await vapi.calls.create({
    assistantId,
    phoneNumberId,
    customer: { number: to },
    assistantOverrides: callOverrides({ purpose, fields, context }),
  });
  if (!("id" in created)) {
    throw new Error("Unexpected batch response from Vapi for a single-customer call.");
  }
  console.log(`Call created: ${created.id} (status: ${created.status}). Polling until it ends...`);

  // Poll instead of standing up a webhook receiver — this script is for
  // ad-hoc testing, not the real product path.
  const TERMINAL = new Set(["ended", "not-found", "deletion-failed"]);
  let call = created;
  for (let i = 0; i < 90 && !TERMINAL.has(call.status ?? ""); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    call = await vapi.calls.get({ id: created.id });
    console.log(`  [${new Date().toLocaleTimeString()}] status: ${call.status}`);
  }

  console.log("\n--- Call result ---");
  console.log("Status:", call.status);
  console.log("Ended reason:", call.endedReason ?? "(none)");
  console.log("Cost: $" + (call.cost ?? 0).toFixed(4));
  console.log("\nTranscript:\n" + (call.artifact?.transcript ?? "(none)"));
  console.log("\nStructured data:", JSON.stringify(call.analysis?.structuredData ?? {}, null, 2));
  console.log("\nRecording:", call.artifact?.recordingUrl ?? "(none)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
