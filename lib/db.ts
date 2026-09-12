import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });
}

// Reuse the pool across hot reloads in dev instead of opening a new one per request.
export const pool = global._pgPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  global._pgPool = pool;
}
