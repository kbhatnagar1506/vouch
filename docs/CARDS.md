# Temporary cards (Stripe Issuing)

One disposable virtual card per transaction, issued via [Stripe
Issuing](https://stripe.com/issuing) in test/sandbox mode — part of the
same onboarding roadmap as Gmail, voice, and bank connection (see the base
`CLAUDE.md` "Service branches"), but usable on its own once a user has a
session, not gated behind the rest of the chain.

## Single-use by default

Every card `POST /api/cards` creates is `single_use = true` unless
explicitly overridden. The moment its first transaction posts —
`issuing_transaction.created` lands on `/api/stripe/webhook` — the card is
immediately set to `canceled` via the Stripe API (`lib/stripe.ts`,
`recordCardTransaction`). That's what actually makes "one card per
transaction" real: a subscription tied to a canceled card can never be
charged again, with no separate cancel step and no dealing with the
merchant directly. `spending_controls.spending_limits` (`interval:
"all_time"`) additionally caps the one transaction the card will ever
authorize, if an amount was given at creation.

Stripe's own webhook retries are handled safely: `card_transactions` has a
unique constraint on `stripe_transaction_id`, and the auto-cancel only
fires on the insert that actually happens (`ON CONFLICT DO NOTHING
RETURNING id` — a retried delivery returns no row and skips it).

## PCI scope

No raw card number, CVC, or expiry is ever requested by, or stored on, our
server — `issued_cards` only holds what Stripe's own card object already
treats as non-sensitive (`last4`, `brand`, expiry, status). To let a user
actually see and use the number:

1. `POST /api/cards/:id/reveal` creates a short-lived Stripe **ephemeral
   key** scoped to exactly that one card (`stripe.ephemeralKeys.create`).
2. The browser uses that key directly with Stripe.js's **Issuing
   Elements** (`issuingCardNumberDisplay` / `...CvcDisplay` /
   `...ExpiryDisplay`, in `components/reveal-card.tsx`) to decrypt and
   render the PAN/CVC/expiry **client-side only**.

This keeps the whole app out of PCI SAQ D scope — the same reason Stripe
recommends never calling `stripe.issuing.cards.retrieve(id, {expand:
["number", "cvc"]})` from a server for anything other than very narrow,
compliance-reviewed cases.

**Not yet verified against a live test-mode card**: the reveal flow is
implemented against Stripe's standard documented Issuing Elements pattern,
but some Stripe accounts additionally require a client-side nonce
(`stripe.createEphemeralKeyNonce()`, threaded through both the ephemeral
key creation and the Element) for extra replay protection. Generate a
card and click "Reveal" once `STRIPE_SECRET_KEY` /
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are set — if Stripe's error message
asks for a nonce, that step needs adding to both
`app/api/cards/[id]/reveal/route.ts` and `components/reveal-card.tsx`.

## Setup

1. [Stripe Dashboard](https://dashboard.stripe.com) → **Issuing** → make
   sure it's activated as **"Issuing for your business"** (issuing cards
   directly to your own users) — not the "Financial Accounts for
   platforms" / Connect path (issuing to *connected accounts*). Picking
   the platform path by mistake pulls in a much bigger Connect
   integration and, empirically, provisions a financial account
   asynchronously rather than instantly; the direct path is documented as
   instant. If Issuing isn't set up at all yet, the API returns "Your
   account is not set up to use Issuing" until you do this in the
   Dashboard — nothing to fix in code.
2. Test mode → Balances → the **Financial account** row → copy its
   **Financial account ID** (`fa_test_...`, shown in the right-hand
   sidebar on that account's balance page) into
   `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID`. See "Financial account" below
   for why this is required at all.
3. Test mode → Developers → API keys → copy the secret and publishable
   keys into `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
4. Developers → Webhooks → add an endpoint at
   `https://cards.getvouch.club/api/stripe/webhook` (or use `stripe
   listen --forward-to localhost:3000/api/stripe/webhook` for local dev,
   or create it via the API with `stripe.webhookEndpoints.create`),
   subscribed to at least `issuing_transaction.created` and
   `issuing_authorization.request`. Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
5. Run `npm run db:migrate`.

Test-mode Issuing authorizations aren't triggered by real purchases —
simulate one from the Dashboard (Test mode → Issuing → a card →
"Simulate authorization") or via `stripe.testHelpers.issuing.authorizations.create`,
which is the only way to see a card actually auto-cancel end to end
without a real merchant transaction.

## Financial account

Card creation on this account rejects a request with no financial account
specified ("The v2 financial account id must be specified"), and further
rejects the older, more commonly-documented `financial_account` parameter
name in favor of a newer one:

```ts
stripe.issuing.cards.create({
  cardholder: cardholderId,
  // ...
  financial_account_v2: process.env.STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID,
});
```

`financial_account_v2` isn't in the installed `stripe` SDK version's typed
parameters yet (only the older `financial_account` field is), so
`lib/stripe.ts` adds it via an untyped spread rather than waiting on an
SDK update. Confirmed empirically, live, against a real test-mode account
— not documented anywhere found at the time this was written.

A freshly-created financial account can sit in `status: "pending"` for a
while before card creation against it succeeds ("You cannot create a new
card for FinancialAccount ... because its status is pending"); nothing to
do but wait and retry — there's no documented way to force it, and the
account-level detail needed to inspect *why* it's pending sits behind an
undocumented Stripe API version requiring a `.preview` suffix, which this
integration deliberately does not depend on.

## Cardholder requirements

The first card request for a given user creates their Stripe Issuing
Cardholder (`ensureCardholder` in `lib/stripe.ts`) — every later request
reuses it. That first creation needs more than the "for your business"
docs' minimal example implies, confirmed by iterating against real `card
creation failed` errors until they cleared:

- `individual.first_name` / `individual.last_name`, not just a top-level
  `name` string — `lib/stripe.ts`'s `splitName()` best-effort splits the
  user's stored display name (falling back to their email's local part if
  blank).
- `individual.card_issuing.user_terms_acceptance.{date,ip}` — Stripe
  requires an explicit, timestamped acceptance of its cardholder terms per
  individual, or every card for them fails with "outstanding requirements
  preventing them from activating an issued card." Recorded here as
  "generating a card implies acceptance," with the requesting browser's IP
  (`getRequestIp` in `app/api/cards/route.ts`) — a real (non-sandbox)
  launch should make this an explicit, visible checkbox instead of an
  implicit side effect of clicking "Generate a card."
- `phone_number` — required for 3D Secure; `POST /api/cards` returns
  `{ phoneRequired: true }` the first time a user without one tries, and
  `components/card-manager.tsx` shows a one-time phone field in response.

## Data model

- `stripe_cardholders` — one Stripe Issuing Cardholder per Vouch user,
  created lazily (`ensureCardholder`), same pattern as gmail-connector's
  `backboard_assistants`.
- `issued_cards` — one row per virtual card: label, optional merchant,
  last4/brand/expiry, `status` (`active` / `inactive` / `canceled`),
  optional `spending_limit_cents`, `single_use`.
- `card_transactions` — a local read model of posted spend per card,
  populated from the webhook so the UI doesn't need a live Stripe API
  call just to show history.
- `mcp_api_keys` — bearer tokens for the MCP server (see "MCP server"
  below); only a SHA-256 hash is ever stored, never the raw token.

`issued_cards`/`card_transactions` don't carry a hard foreign key to
gmail-connector's `gmail_messages` / `gmail_message_classifications` even
though both live in the same shared database — this branch's own
migrations need to stay applicable to a fresh database on their own,
without depending on another service branch's migrations having run
first. A UI that suggests "issue a card for this detected subscription"
can still join across at the application level once both services are
deployed together; it just isn't a schema-level dependency.

## MCP server (Claude, OpenAI agents, …)

`app/api/mcp` exposes the card lifecycle above as an
[MCP](https://modelcontextprotocol.io) server (`@modelcontextprotocol/sdk`,
Streamable HTTP transport) — any MCP-speaking client works against it,
Claude or OpenAI-based agents alike; MCP is a protocol, not a
vendor-specific integration, so this is one server, not two.

**Tools**: `create_temporary_card`, `list_cards`, `freeze_card`,
`unfreeze_card`, `cancel_card`, `simulate_purchase`
(`lib/mcp/server.ts`) — thin wrappers over the exact same `lib/stripe.ts`
functions the human-facing `/cards` UI calls. Same PCI guarantee both
places: **no tool ever returns the card number or CVC**, only what
Stripe's own card object already treats as non-sensitive (last4, brand,
expiry, status).

**`simulate_purchase`** is how an agent actually "spends" from a card: it
drives a real Stripe test-mode Issuing authorization against that card's
own `spending_controls` — Stripe itself approves or declines, not
application code — and captures it immediately if approved, which
produces a genuine `issuing_transaction.created` event that the existing
webhook handler picks up exactly as it would for any other transaction
(recording it, auto-canceling a single-use card). **This is not a general
"buy anything from any online merchant" capability** — Stripe Issuing
authorizations are pull-based (a merchant/terminal charges the card; you
can't push a purchase to an arbitrary live merchant via API), and this
whole branch runs in Stripe test mode besides. What it *does* give an
agent: create a scoped, disposable card for an intended purchase, and get
a real, correctly-enforced approve/decline answer against its spend limit
— the actual point of "can an agent purchase things" for this integration.
Bridging to a real arbitrary live checkout is a separate, larger problem
(browser/checkout automation, or a specific merchant's own payments API),
deliberately not attempted here.

### Auth: bearer API keys, not the session cookie

MCP clients aren't browsers — they can't carry `vouch_session`, which is
how every other route here identifies a user. So `/api/mcp` sits
deliberately outside `middleware.ts`'s cookie-based protection
(`app/api/mcp/route.ts` isn't in its matcher at all) and authenticates
every request itself via `Authorization: Bearer <token>`.

1. From a signed-in browser session, `POST /api/mcp/keys` (optionally
   `{ "label": "..." }`) mints a new key and returns `{ id, token }` — the
   raw token is shown **exactly once**; only its SHA-256 hash is stored
   (`mcp_api_keys`, `lib/mcp/api-keys.ts`). `GET /api/mcp/keys` lists keys
   (label, timestamps — never the token again);
   `POST /api/mcp/keys/:id/revoke` revokes one.
2. Configure the MCP client (Claude, an OpenAI Agents SDK integration,
   etc.) with that token as its bearer credential against
   `https://cards.getvouch.club/api/mcp`.
3. Every tool call after that runs as the user that key belongs to —
   `create_temporary_card` issues cards under their Stripe cardholder,
   `list_cards` only ever sees their own cards, etc.

**Known gap**: this is a static, self-service bearer key, not a full
OAuth 2.1 authorization flow. That's the spec-preferred way for a client
like Claude.ai or ChatGPT to offer "connect your Vouch account" as a
one-click flow directly in their own UI, and is a reasonable next step —
just substantially more scope (an authorization server: dynamic client
registration, consent screen, token exchange) than a first pass needed.
The bearer-key model is secure and standard for developer-facing
integrations in the meantime (mint it once, paste it into whatever MCP
client config); it just isn't a point-and-click connect flow yet.

**Also not yet built**: any rate limiting on `/api/mcp` — a compromised or
overly-eager agent could mint cards or attempt authorizations in a tight
loop. Worth a per-key cap before this is handed to a real, untrusted
integration rather than a single developer's own client.

## Multi-tenancy

Same contract as every other service branch: reads the `vouch_session`
cookie the portal issues (HS256 JWT, `{ userId, email }`, `JWT_SECRET`
shared across services, `SESSION_COOKIE_DOMAIN=.getvouch.club`).
`middleware.ts` protects `/cards` and `/api/cards/*`; `/api/stripe/webhook`
is exempt (Stripe's servers call it directly, with no session cookie).

## Deploy

Same Vercel project (`acme-1b76/vouch`), this branch bound to
`cards.getvouch.club` via Git Branch Domains — see the base `CLAUDE.md`
"Service branches" section for the general pattern.

## Mock mode (`CARD_ISSUING_MODE=mock`)

This account's Stripe Issuing **Financial Account is stuck in `pending`**.
Stripe refuses every card creation against it —

> You cannot create a new card for FinancialAccount `fa_test_…` because its
> status is pending. Please try again with an open FinancialAccount.

— which makes everything downstream of a card (simulate_purchase, the
webhook, transactions on the dashboard) impossible to exercise at all.

Setting `CARD_ISSUING_MODE=mock` swaps Stripe out for `lib/card-mock.ts`
and leaves the rest of the system untouched:

- Mock cards are ordinary `issued_cards` rows, marked by an `ic_mock_`
  `stripe_card_id`. List, freeze, unfreeze, cancel, the dashboard, and the
  transactions table are all DB-backed and need no knowledge of mock mode —
  only the four functions in `lib/stripe.ts` that actually call Stripe
  branch, so a mock and a real card can coexist and each is routed by its
  own id.
- `simulate_purchase` applies the same three rules Stripe would: a canceled
  card declines, a frozen card declines, and an amount over the card's
  spending limit declines as `spending_controls`. On approval it records the
  transaction and auto-cancels a single-use card — the bookkeeping the real
  webhook does on `issuing_transaction.created`, done inline because nothing
  external fires a webhook for a mock purchase.
- `create_temporary_card` returns a **card number** in this mode only. By
  default it is random digits behind Stripe's `4242` test prefix, never
  persisted and authorizing nothing. Set `MOCK_CARD_NUMBER` (with
  `MOCK_CARD_CVC` and `MOCK_CARD_EXP_MONTH`/`MOCK_CARD_EXP_YEAR`) to pin a
  card provisioned elsewhere, so every issuance shows the same number —
  what a live demo wants. It stays in env rather than in source: a card
  number committed here would live in git history and every clone from then
  on. A card issued through Stripe never returns its PAN from the server at
  all — that is revealed client-side via an ephemeral key (see "PCI scope").
- The "authorizes nothing" caveat is attached only to a locally generated
  number, where it is true. A pinned card is a real card, so it isn't
  labelled that way; `generated: false` in the tool's structured output is
  what tells the two apart.
- **Pinning a number changes only what this server displays.** It does not
  make a purchase succeed anywhere: `simulate_purchase` still decides
  locally and never contacts a payment network, and whether the card itself
  clears at a real merchant depends entirely on the Stripe account that
  issued it (a test-mode card is not on the card networks and will be
  declined).

Default is `live`, so a missing env var can never silently mint fake cards.

Verified end to end against a local Postgres with all five migrations
applied, driving the deployed tool surface over MCP: create → decline over
limit → freeze → decline frozen → unfreeze → approve → auto-cancel →
decline on the dead card, with the transaction landing in
`card_transactions` and the key's `last_used_at` updating.

## Connecting an agent (MCP)

`/cards` has an **Agent access** panel: name a key, click Create key, and
the raw token is shown once (only its hash is stored — see
`lib/mcp/api-keys.ts`), along with a ready-to-paste install command. Keys
are listed with their created/last-used dates and can be revoked.

The endpoint is public — it is not behind Vercel's SSO deployment
protection — and authenticates purely on the bearer token, which is what
lets an MCP client reach it at all.

**Claude Code:**

```sh
claude mcp add --transport http vouch-cards \
  https://cards.getvouch.club/api/mcp \
  --header "Authorization: Bearer mcpk_..."
```

The header value is sent verbatim, so the `Bearer ` prefix must be
included. Check it with `claude mcp list` (or `/mcp` in a session).

**Claude Desktop** — its Connectors UI doesn't take a static bearer token,
so configure it by hand in `claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "vouch-cards": {
      "type": "http",
      "url": "https://cards.getvouch.club/api/mcp",
      "headers": { "Authorization": "Bearer mcpk_..." }
    }
  }
}
```

**claude.ai** — custom connectors there generally expect OAuth. Static
request headers exist but are a gated beta, so if the Add custom connector
dialog shows no "Request headers" section, this server can't be added on
the web and Claude Code or Desktop is the way in.
