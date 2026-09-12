import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/PLAID.md for setup.`);
  }
  return value;
}

function resolvePlaidEnv(): keyof typeof PlaidEnvironments {
  const env = process.env.PLAID_ENV ?? "sandbox";
  if (env !== "sandbox" && env !== "development" && env !== "production") {
    throw new Error(`Invalid PLAID_ENV "${env}". Use sandbox, development, or production.`);
  }
  return env;
}

declare global {
  // eslint-disable-next-line no-var
  var _plaidClient: PlaidApi | undefined;
}

function createClient(): PlaidApi {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[resolvePlaidEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": requiredEnv("PLAID_CLIENT_ID"),
        "PLAID-SECRET": requiredEnv("PLAID_SECRET"),
      },
    },
  });
  return new PlaidApi(configuration);
}

// Constructed lazily (not at module load) so importing this file doesn't
// crash when Plaid env vars aren't set — e.g. during `next build`'s route
// analysis, or in environments that don't use this feature yet.
export function getPlaidClient(): PlaidApi {
  if (!global._plaidClient) {
    global._plaidClient = createClient();
  }
  return global._plaidClient;
}
