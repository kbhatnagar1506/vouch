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

`issued_cards`/`card_transactions` don't carry a hard foreign key to
gmail-connector's `gmail_messages` / `gmail_message_classifications` even
though both live in the same shared database — this branch's own
migrations need to stay applicable to a fresh database on their own,
without depending on another service branch's migrations having run
first. A UI that suggests "issue a card for this detected subscription"
can still join across at the application level once both services are
deployed together; it just isn't a schema-level dependency.

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
