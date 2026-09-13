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

1. [Stripe Dashboard](https://dashboard.stripe.com) → make sure **Issuing**
   is enabled for the account (test mode issuing is available by default
   on new accounts; live-mode issuing needs additional underwriting —
   irrelevant here since this is sandbox-only).
2. Test mode → Developers → API keys → copy the secret and publishable
   keys into `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
3. Developers → Webhooks → add an endpoint at
   `https://cards.getvouch.club/api/stripe/webhook` (or use `stripe
   listen --forward-to localhost:3000/api/stripe/webhook` for local dev),
   subscribed to at least `issuing_transaction.created` and
   `issuing_authorization.request`. Copy its signing secret into
   `STRIPE_WEBHOOK_SECRET`.
4. Run `npm run db:migrate`.

Test-mode Issuing authorizations aren't triggered by real purchases —
simulate one from the Dashboard (Test mode → Issuing → a card →
"Simulate authorization") or via `stripe.testHelpers.issuing.authorizations.create`,
which is the only way to see a card actually auto-cancel end to end
without a real merchant transaction.

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
