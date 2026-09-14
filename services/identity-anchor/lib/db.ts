import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var _pgPool: Pool | undefined;
}

function createPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10_000,
  });
}

// Constructed lazily (not at module load) so importing this file doesn't
// crash when DATABASE_URL isn't set yet — e.g. during `next build`'s route
// analysis in an environment (like a fresh Preview deploy) that hasn't had
// env vars configured for it yet. Reused across hot reloads in dev.
function getPool(): Pool {
  if (!global._pgPool) {
    global._pgPool = createPool();
  }
  return global._pgPool;
}

// Proxy so existing call sites (`pool.query(...)`) don't need to change —
// each property access lazily resolves to the real pool, with methods
// bound to it so `this` inside them is correct.
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop, _receiver) {
    const real = getPool();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});
