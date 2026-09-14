# bank-connection — Plaid link, and the convention the rest of Vouch follows

`bankconnection.getvouch.club` · [full docs](docs/PLAID.md)

Links a real bank account through Plaid and keeps accounts and balances in the
shared database, so the dashboard's budget compares spending against money that
actually exists.

This was also the **first service branch**, so it's where the architecture the
other seven follow was worked out.

## The convention this branch established

One repo, one database, one session cookie, one branch per service, one
subdomain per branch.

Every service is a long-lived git branch deployed to its own subdomain through
Vercel's Git Branch Domains. Pushing to `bank-connection` deploys
`bankconnection.getvouch.club`. No second Vercel project, no service mesh, no
container orchestration — and each service is still independently deployable,
independently breakable, and reachable at a real URL.

The rules, written down in the root `CLAUDE.md` because they were learned here:

- **Shared database, shared `lib/db.ts` setup.** Don't fork the connection per
  service; extend the schema through `db/migrations/`.
- **Each branch carries its own copy** of `lib/session.ts`, `lib/crypto.ts` and
  friends rather than importing across branches. They share a database and a
  session cookie, not a codebase. The duplication is deliberate: a branch can be
  rewritten or broken without reaching into another one.
- **Env vars are per-environment, not inherited.** A service branch deploys to
  Vercel's *Preview* environment, so its secrets have to be added there
  explicitly.
- **Preview deploys sit behind Vercel's SSO protection by default**, which is
  fine for browsing and blocks third-party webhooks. That's a per-service,
  security-relevant decision, not a default to flip quietly.

## Work worth reading

**Plaid access tokens are encrypted at rest.** A Plaid access token is a
long-lived credential for someone's bank, so it's stored as AES-256-GCM
ciphertext rather than plaintext. The same `lib/crypto.ts` helper later became
the pattern for voice-verification's biometric embeddings.

**The link flow is server-mediated end to end.** Plaid Link runs in the browser
and returns a short-lived `public_token`, which is exchanged for the real access
token **server-side**. The browser never holds anything that outlives the
session.

**The step is skippable, and the skip is always visible.** Originally the skip
only rendered before the first account was linked — so once you connected one,
the only way forward was a button further down the page. Every onboarding step
in Vouch is now skippable at every stage: nothing here is required to reach the
dashboard, and a bank can be linked later.

## Onboarding position

`login → Gmail → **bank** → Stripe cards → voice → dashboard`

Each step's "next" target is an env var rather than a hardcoded URL, which is
what made inserting the Stripe step between this one and voice a one-line
change.

## Stack

Next.js 15 · TypeScript · PostgreSQL · Plaid · AES-256-GCM

See [`docs/PLAID.md`](docs/PLAID.md) for setup, the token exchange, the data
model, and the worked example of binding a branch to a subdomain.
