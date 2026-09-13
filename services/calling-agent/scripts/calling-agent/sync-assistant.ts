// Upserts the one Vapi assistant this branch manages, from code
// (lib/calling-agent/assistant.ts) — no dashboard clicking required.
//
//   npm run calling-agent:sync-assistant
//
// First run: creates the assistant and prints its id — copy that into
// VAPI_ASSISTANT_ID (.env locally, and this branch's Vercel env vars).
// Every run after that updates the same assistant in place.
import { VapiClient } from "@vapi-ai/server-sdk";
import { ASSISTANT_NAME, baseAssistantConfig } from "../../lib/calling-agent/assistant";

async function main() {
  const apiKey = process.env.VAPI_API_KEY;
  if (!apiKey) {
    console.error("VAPI_API_KEY is not set. See docs/CALLING_AGENT.md for setup.");
    process.exit(1);
  }
  const vapi = new VapiClient({ token: apiKey });
  const config = baseAssistantConfig();

  const existingId = process.env.VAPI_ASSISTANT_ID;
  if (existingId) {
    const updated = await vapi.assistants.update({ id: existingId, ...config });
    console.log(`Updated "${updated.name}" (${updated.id}).`);
    return;
  }

  console.log(`VAPI_ASSISTANT_ID not set — looking for an assistant named "${ASSISTANT_NAME}"...`);
  const existing = await vapi.assistants.list();
  const match = existing.find((a) => a.name === ASSISTANT_NAME);

  const result = match ? await vapi.assistants.update({ id: match.id, ...config }) : await vapi.assistants.create(config);

  console.log(`${match ? "Updated" : "Created"} "${result.name}" (${result.id}).`);
  if (!match) {
    console.log(`\nSet VAPI_ASSISTANT_ID=${result.id} in .env (and this branch's Vercel env vars) to reuse it next time.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
