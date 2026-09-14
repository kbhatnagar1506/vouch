# portal — the only service that issues a session

`login.getvouch.club`

Signup and login. Every other Vouch service verifies the cookie this branch
issues, and none of them can mint one.

## The problem this branch actually solves

Vouch is eight independently deployed apps on eight subdomains. A user signs in
once and moves through Gmail, bank, cards, voice and the dashboard without
noticing they've crossed services four times.

The usual answers are an identity provider, an API gateway, or a session store
every service reads from. All three add infrastructure that has to be running
for anyone to log in anywhere.

Instead: **one HS256 JWT in a cookie scoped to `.getvouch.club`**, with a single
shared `JWT_SECRET`. The browser sends it to every subdomain automatically.
Verification is a local signature check — no network call, no shared session
table, no single point of failure at request time.

## The contract, and why it's written down everywhere

Because verification is stateless, the *format* is the interface. Every branch's
`lib/session-token.ts` carries a comment pointing back here, because these four
things have to agree exactly or a session silently doesn't exist:

- **Cookie name** — `vouch_session`
- **Claims** — `userId`, `email`
- **Algorithm** — HS256
- **Secret** — byte-identical `JWT_SECRET` across all eight services

The failure mode is what makes it worth documenting: a mismatch doesn't error,
it just fails to authenticate, and a user gets bounced back to login with
nothing in any log saying why.

Two libraries are in play and that's fine — this branch signs with
`jsonwebtoken`, the others verify with `jose`. Both implement RFC 7519, so they
interoperate; the comment in each branch says so explicitly to stop someone
"fixing" the inconsistency.

## Work worth reading

**Every service branch is edge-safe.** The session logic lives in
`lib/session-token.ts` with **no database import**, because Next.js middleware
runs on the Edge runtime and can't load `pg` (it needs Node's `net`/`tls`). The
split isn't stylistic — putting the user lookup in the same file would break
middleware on every branch at once.

**The header is a hint, never the authority.** Middleware sets `x-user-id` after
verifying the cookie, but route handlers re-verify it themselves through
`getCurrentUser()`. A header is trivially forged if anything ever reaches a
route without passing through middleware, so nothing trusts it on its own.

**Sign-out is the one thing shared state would help with**, and the tradeoff is
explicit: a stateless JWT can't be revoked before it expires. The TTL is 30
days, and the cookie options (`httpOnly`, `secure`, `sameSite: lax`, the
`.getvouch.club` domain) have to match across branches or clearing the session
on one subdomain leaves it live on another.

## Stack

Next.js 15 · TypeScript · PostgreSQL · `jsonwebtoken` (HS256)

The multi-tenancy contract is documented from the consuming side in
[bank-connection's `docs/PLAID.md`](https://github.com/kbhatnagar1506/vouch/blob/bank-connection/docs/PLAID.md)
and in every other branch's "Multi-tenancy" section.
