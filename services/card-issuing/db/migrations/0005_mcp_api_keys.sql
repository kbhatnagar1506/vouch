-- Bearer API keys for the MCP server (app/api/mcp/route.ts). MCP clients
-- (Claude, ChatGPT/OpenAI agents, etc.) aren't browsers -- they can't carry
-- the vouch_session cookie every other route in this app relies on -- so
-- this is a separate, simpler auth mechanism: a long-lived, revocable
-- bearer token per user, minted via the cookie-authenticated
-- POST /api/mcp/keys and sent as `Authorization: Bearer <token>` on every
-- MCP request. Only the SHA-256 hash is ever stored -- the raw token is
-- shown exactly once, at creation, same principle as GitHub/Stripe API keys.
create table if not exists mcp_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  label text not null default '',
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists mcp_api_keys_user_id_idx on mcp_api_keys (user_id);
