# Gmail connector

Read-only Gmail OAuth connector — part of the onboarding chain
(signup/login → **Gmail** → bank → voice registration). Adapted from
`aaditisinghal/vouch-aaditi`'s `feature/gmail-connector` branch (she
removed it there before merging her login/signup work into `portal`;
ported here as its own service branch instead of losing the work).

## What changed from the original

Only the plumbing, not the logic — same OAuth flow, same scopes, same
token-refresh behavior:

- `lib/db.ts`: `import pool from "@/lib/db"` (default export) →
  `import { pool } from "@/lib/db"` (named), matching every other branch
  in this repo.
- `lib/crypto.ts`: her `encrypt`/`decrypt` (hex key) → this repo's
  `encryptSecret`/`decryptSecret` (base64 key, same `ENCRYPTION_KEY`
  bank-connection and voice-verification already use — one shared secret
  across services, not a new `TOKEN_ENCRYPTION_KEY`).
- Auth checks: her manual `verifySession(cookie)` calls in every route →
  this repo's `requireUser()`/`getCurrentUser()` (`lib/session.ts`), same
  underlying JWT contract.
- `migrations/002_create_gmail_connections.sql` (`user_id UUID`) →
  `db/migrations/0001_gmail_connections.sql` (`user_id TEXT`, matching
  `users.id` everywhere else in this shared DB).
- The connector was previously an embeddable widget inside her
  login-extend page; here it's the whole `/connect` page (this branch's
  entire purpose), with a real Gmail icon (`components/gmail-icon.tsx`)
  instead of plain text, and a "Skip for now" link so onboarding isn't
  blocked on it.
- Redirect targets updated for this repo's actual chain: success goes to
  `BANK_CONNECTION_URL` (not her `/login-extend`); failure returns to this
  branch's own `/connect?gmail_error=...` (not portal's login-extend,
  since Gmail-connector is its own service branch now, not part of
  portal).

## Setup

1. Google Cloud Console → APIs & Services → create an OAuth 2.0 Web
   application client. Authorized redirect URI:
   `https://gmail.getvouch.club/api/connectors/gmail/callback` (must match
   `NEXT_PUBLIC_APP_URL` + that path, or `GOOGLE_REDIRECT_URI` exactly).
2. Enable the Gmail API for the project.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`
   (see `.env.example`).
4. Run `npm run db:migrate`.

## Multi-tenancy

Same contract as every other service branch: reads the `vouch_session`
cookie the portal issues (HS256 JWT, `{ userId, email }`, `JWT_SECRET`
shared across services, `SESSION_COOKIE_DOMAIN=.getvouch.club`).
`middleware.ts` protects `/connect` and the read/write Gmail API routes;
`/api/connectors/gmail/{connect,callback}` are exempt from middleware and
check auth themselves (they're the OAuth handshake — a JSON 401 would
break the browser redirect).

## Deploy

Same Vercel project (`acme-1b76/vouch`), this branch bound to
`gmail.getvouch.club` via Git Branch Domains — see the base `CLAUDE.md`
"Service branches" section for the general pattern.
