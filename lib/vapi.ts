import { VapiClient } from "@vapi-ai/server-sdk";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/CALLING_AGENT.md for setup.`);
  }
  return value;
}

declare global {
  // eslint-disable-next-line no-var
  var _vapiClient: VapiClient | undefined;
}

function createClient(): VapiClient {
  return new VapiClient({ token: requiredEnv("VAPI_API_KEY") });
}

// Constructed lazily (not at module load) — same rationale as lib/db.ts's
// pool and lib/plaid.ts's client: importing this file shouldn't crash
// `next build`'s route analysis, or any environment that doesn't have
// VAPI_API_KEY set yet.
export function getVapiClient(): VapiClient {
  if (!global._vapiClient) {
    global._vapiClient = createClient();
  }
  return global._vapiClient;
}
