# `card-issuing` service

| | |
|---|---|
| **Branch** | `card-issuing` (ref: `origin/card-issuing`, HEAD `3a90caf` at time of writing) |
| **Subdomain** | `cards.getvouch.club` |
| **Role** | Disposable, one-per-transaction virtual cards via Stripe Issuing, plus an MCP server exposing the same card lifecycle to LLM agents |
| **Baseline docs read** | `docs/CARDS.md`, `CLAUDE.md` (both on this branch), root `ARCHITECTURE.md` §§1, 6–8 (on `claude/vigilant-meitner-fxqi9c`) |

This document is a from-source verification and deepening of this branch's
own `docs/CARDS.md`, produced by reading every file on the branch (via
`git show origin/card-issuing:<path>`) rather than trusting the docs alone.
Everywhere the two disagree or the docs under-specify something, the code
wins and is called out explicitly.

---

## 1. Purpose & role

`card-issuing` is one of eight service branches in the Vouch monorepo (see
root `ARCHITECTURE.md`). Its job: given a signed-in Vouch user, mint a
**virtual card, single-use by default, via Stripe Issuing test mode**, such
that the moment the card's first transaction posts, Stripe cancels it —
making "one card per subscription/transaction" a structural guarantee
enforced by Stripe itself, not an app-level promise. A user (or an agent
acting for them — see §6) generates a card for an intended purchase,
completes that one purchase, and the card is thereafter permanently dead;
no separate "remember to cancel" step, no contacting the merchant.

It is usable standalone once a user has a session (it is **not** gated
behind the rest of Vouch's onboarding chain — gmail → bank → voice —
despite living in that same roadmap), and it is the only service branch
that also ships a second, non-browser interface: a full MCP server so
Claude, ChatGPT/OpenAI agents, or any other MCP client can create and
manage these cards directly.

---

## 2. File & directory structure

```
.env.example
CLAUDE.md
app/
  api/
    auth/
      logout/route.ts
      me/route.ts
    cards/
      [id]/
        cancel/route.ts
        freeze/route.ts
        reveal/route.ts
        unfreeze/route.ts
      route.ts
    health/route.ts
    mcp/
      keys/
        [id]/revoke/route.ts
        route.ts
      route.ts
    stripe/
      webhook/route.ts
  cards/page.tsx
  globals.css
  layout.tsx
  page.tsx
components/
  card-manager.tsx
  reveal-card.tsx
db/
  migrations/
    0001_stripe_cardholders.sql
    0002_issued_cards.sql
    0003_card_transactions.sql
    0004_users_name.sql
    0005_mcp_api_keys.sql
docs/CARDS.md
lib/
  auth.ts
  crypto.ts
  db.ts
  mcp/
    api-keys.ts
    server.ts
  session-token.ts
  session.ts
  stripe.ts
middleware.ts
next.config.ts
package.json / package-lock.json
public/logo1.png
scripts/migrate.mjs
tsconfig.json
```

| File | Purpose |
|---|---|
| `.env.example` | Template for every env var this branch reads (§8) |
| `CLAUDE.md` | Local copy of deploy + service-branch conventions, plus a short "Temporary cards + MCP" summary pointing at `docs/CARDS.md` |
| `app/api/auth/logout/route.ts` | `POST` — clears the `vouch_session` cookie |
| `app/api/auth/me/route.ts` | `GET` — returns the current session's user (or `null`) |
| `app/api/cards/route.ts` | `GET` list / `POST` create virtual cards |
| `app/api/cards/[id]/cancel/route.ts` | `POST` — terminally cancel a card |
| `app/api/cards/[id]/freeze/route.ts` | `POST` — reversibly deactivate a card |
| `app/api/cards/[id]/unfreeze/route.ts` | `POST` — reactivate a frozen card |
| `app/api/cards/[id]/reveal/route.ts` | `POST` — issue a Stripe ephemeral key so the browser can decrypt the real PAN/CVC client-side |
| `app/api/health/route.ts` | `GET` — DB connectivity probe (`select now(), version()`) |
| `app/api/mcp/route.ts` | `GET`/`POST`/`DELETE` — the MCP server endpoint itself (bearer-token auth) |
| `app/api/mcp/keys/route.ts` | `GET` list / `POST` mint MCP bearer API keys (session-cookie auth) |
| `app/api/mcp/keys/[id]/revoke/route.ts` | `POST` — revoke one MCP API key |
| `app/api/stripe/webhook/route.ts` | `POST` — Stripe webhook receiver (signature-verified) |
| `app/cards/page.tsx` | The `/cards` page: email/logout header + `<CardManager/>` |
| `app/layout.tsx` | Root layout (title "Vouch") |
| `app/page.tsx` | `/` — a bare DB-health-check page (leftover scaffold, not part of the card flow) |
| `app/globals.css` | Two rules: `color-scheme` + body reset |
| `components/card-manager.tsx` | Client component: card creation form, card list, cancel button, opens `<RevealCard/>` |
| `components/reveal-card.tsx` | Client component: mounts Stripe.js Issuing Elements (number/CVC/expiry) using an ephemeral key |
| `db/migrations/0001_stripe_cardholders.sql` | `stripe_cardholders` table |
| `db/migrations/0002_issued_cards.sql` | `issued_cards` table |
| `db/migrations/0003_card_transactions.sql` | `card_transactions` table |
| `db/migrations/0004_users_name.sql` | Adds `users.name` (bugfix, see §11) |
| `db/migrations/0005_mcp_api_keys.sql` | `mcp_api_keys` table |
| `docs/CARDS.md` | This branch's own detailed setup/data-model/PCI doc |
| `lib/auth.ts` | Re-exports session-token helpers + `getUserById()` (`id, email, name`) |
| `lib/crypto.ts` | AES-256-GCM `encryptSecret`/`decryptSecret` helpers, carried for cross-branch consistency — **not called anywhere on this branch** (§10) |
| `lib/db.ts` | Lazy-proxy `pg.Pool` singleton shared by every table this branch touches |
| `lib/mcp/api-keys.ts` | Mint/list/revoke/verify MCP bearer API keys (SHA-256 hashed at rest) |
| `lib/mcp/server.ts` | Builds the per-request `McpServer` and registers its six tools |
| `lib/session-token.ts` | Pure JWT (HS256, `jose`) session verify/issue — no DB import, Edge-safe |
| `lib/session.ts` | `getCurrentUser()` / `requireUser()` for Server Components & route handlers |
| `lib/stripe.ts` | All Stripe Issuing logic: cardholders, cards, freeze/cancel, reveal, webhook verification, transaction recording, test-mode purchase simulation |
| `middleware.ts` | Edge middleware: cookie-gates `/cards`, `/api/cards/*`, `/api/mcp/keys/*`; exempts `/api/stripe/webhook`; does **not** touch `/api/mcp` itself |
| `next.config.ts` | Empty/default Next config |
| `scripts/migrate.mjs` | Minimal hand-rolled migration runner (applies `db/migrations/*.sql` in filename order, tracked in `_migrations`) |

---

## 3. Multi-tenancy & session model

Same contract as every other Vouch service branch (see root
`ARCHITECTURE.md` §3): the `portal` branch is the sole issuer of
`vouch_session`, an HS256 JWT (`{ userId, email }`) signed with a shared
`JWT_SECRET`, set on cookie domain `.getvouch.club` so every subdomain can
read it. `lib/session-token.ts` verifies it with **no database import**
(so `middleware.ts` can run on the Edge runtime, which cannot load `pg`).
`middleware.ts` here gates:

- **Pages:** `/cards`
- **APIs:** `/api/cards/*`, `/api/mcp/keys/*`
- **Exempt:** `/api/stripe/webhook` (Stripe's servers call it directly —
  no cookie, and a JSON 401 would just make Stripe retry forever)
- **Deliberately outside the matcher entirely:** `/api/mcp` (see §6.3) and
  `/api/auth/*`, `/api/health` (unauthenticated by design)

An unauthenticated hit on a protected **page** redirects to
`PORTAL_LOGIN_URL`; on a protected **API** it returns a plain `401 { error:
"Not authenticated" }`. There is no login UI on this branch at all — the
portal branch owns sign-in.

---

## 4. Stripe Issuing integration (`lib/stripe.ts`)

One Stripe client, constructed lazily and cached (`getStripeClient()`),
pinned to API version `2024-12-18.acacia` — pinned explicitly (rather than
left to the SDK default) because `createCardEphemeralKey` has to pass that
exact same version string again, and there's no runtime constant to read
it back from the client instance.

### 4.1 Cardholder creation — real requirements found via live testing

`ensureCardholder(user, { phoneNumber?, termsAcceptanceIp })` creates
**exactly one** Stripe Issuing Cardholder per Vouch user, lazily on first
card request, cached in `stripe_cardholders`; every later call just
returns the cached id (no phone number or IP needed again). Commit
`d5d5294` ("Fix real Stripe Issuing requirements found via live testing")
is where this got nailed down against real `card creation failed` /
"outstanding requirements" errors — the requirements weren't obvious from
Stripe's "Issuing for your business" docs' minimal example:

| Requirement | Field | How it's satisfied here |
|---|---|---|
| Structured name | `individual.first_name` / `individual.last_name` (a flat top-level `name` is *not* sufficient) | `splitName()` best-effort splits `user.name` on whitespace; falls back to the email's local part if the stored name is blank (e.g. the `demo-user` seed row) |
| Cardholder type | `type: "individual"` | Hardcoded — **only individual cardholders are supported**, no company-type path exists in this code |
| Terms acceptance | `individual.card_issuing.user_terms_acceptance.{date, ip}` | Recorded automatically the moment a user's *first* card is generated — "generating a card implies acceptance." `date` is `Math.floor(Date.now()/1000)`; `ip` is the requesting browser's IP (`getRequestIp()` in `app/api/cards/route.ts`, from `x-forwarded-for`/`x-real-ip`). **Code comment flags this as sandbox-only shortcut**: "a real (non-sandbox) launch should make this an explicit, visible checkbox instead of an implicit side effect of clicking 'Generate a card.'" |
| Phone number | `phone_number` (required by Stripe for 3D Secure) | Only required on a brand-new cardholder. If missing, `ensureCardholder` throws `PhoneNumberRequiredError`; `POST /api/cards` catches it and returns `{ phoneRequired: true }`, and `card-manager.tsx` then shows a one-time phone input and retries |
| Billing address | `billing.address.{line1,city,state,postal_code,country}` | **Hardcoded placeholder** ("185 Berry St", San Francisco, CA 94107, US) for every cardholder — test-mode cardholders still require *some* address. Code comment: "Swap this for real billing details before any production (non-test-mode) use — Stripe will reject a live cardholder with obviously fake address data." No real per-user address is collected anywhere in this branch. |

### 4.2 Financial account — the `financial_account_v2` gotcha

Card creation on the connected Stripe account **rejects requests with no
financial account specified** ("The v2 financial account id must be
specified"), and further rejects the older, more commonly-documented
`financial_account` param name in favor of a newer `financial_account_v2`:

```ts
stripe.issuing.cards.create({
  cardholder: cardholderId,
  currency: "usd",
  type: "virtual",
  status: "active",
  spending_controls: /* ... */,
  // financial_account_v2 isn't in the installed SDK's typed params yet
  // (only the older `financial_account` is) -- added via an untyped
  // spread rather than waiting on an SDK update.
  ...({ financial_account_v2: getIssuingFinancialAccountId() } as Record<string, string>),
});
```

This is a verbatim match for `lib/stripe.ts`'s `createVirtualCard()`. The
installed `stripe` SDK is **17.5.0**, which types `financial_account` but
not `financial_account_v2` — hence the `as Record<string, string>` escape
hatch rather than a proper typed field.

**Cross-checked against root `ARCHITECTURE.md` §7** ("Things that are
honest about their limits"), which says, verbatim:

> **Stripe Issuing is provisioning.** The sandbox Financial Account is
> stuck `status: pending`, and Stripe's API refuses card creation until it
> opens. Not a code problem — `financial_account_v2` is already passed
> correctly, so minting works the moment it flips.

**Confirmed in code**: this is accurate. `financial_account_v2` is indeed
passed on every `stripe.issuing.cards.create()` call as shown above, so the
architecture doc's claim that the *code* is already correct — and that the
remaining blocker is purely Stripe-side provisioning latency, not
something to fix here — holds up. `docs/CARDS.md` independently documents
the same failure mode ("You cannot create a new card for FinancialAccount
... because its status is pending; nothing to do but wait and retry") and
notes the deeper diagnostic API for *why* it's pending sits behind an
undocumented `.preview`-suffixed API version this integration deliberately
doesn't depend on.

Also documented (setup step 1 in `docs/CARDS.md`, and consistent with the
commit message for `d5d5294`): the Stripe dashboard offers two different
Issuing setups — **"Issuing for your business"** (direct-to-your-own-users,
provisions instantly) vs. **"Financial Accounts for platforms"**
(Connect-based, issuing to *connected* accounts, provisions
asynchronously). Picking the Connect path by mistake is called out as the
likely root cause of most of this section's pain being undiscoverable from
docs alone.

### 4.3 Card creation & the single-use auto-cancel mechanism

`createVirtualCard(user, input)`:
1. `ensureCardholder(...)` (§4.1)
2. `stripe.issuing.cards.create({ type: "virtual", status: "active", currency: "usd", spending_controls, financial_account_v2 })` — virtual only, no physical fulfillment path exists
3. Inserts a row into `issued_cards` with only Stripe's already-non-sensitive card fields (`last4`, `brand`, `exp_month`, `exp_year`, `status`)

`singleUse` defaults to **`true`** (`input.singleUse ?? true`) — a fresh,
disposable card per transaction is the default issuance model, not an
opt-in. If `spendingLimitCents` is given, it's applied as
`spending_controls.spending_limits: [{ amount, interval: "all_time" }]` —
Stripe itself enforces this cap at authorization time (§5, webhook
section) regardless of anything this app does afterward.

**What actually makes "one card per transaction" real** is not the
`single_use` flag alone — it's `recordCardTransaction()`, invoked from the
Stripe webhook handler (§5) on every `issuing_transaction.created` event:
the instant a single-use card's *first* transaction is recorded, this
function calls `stripe.issuing.cards.update(stripeCardId, { status:
"canceled" })` synchronously against Stripe, before returning. A canceled
Stripe card cannot be un-canceled and cannot authorize again — so a
subscription tied to it is structurally dead, with no separate "go cancel
with the merchant" step. Webhook retry safety is handled at the DB layer:
`card_transactions.stripe_transaction_id` is `unique`, the insert uses `on
conflict (stripe_transaction_id) do nothing returning id`, and the
auto-cancel branch only runs when that insert actually returned a row — a
redelivered webhook for an already-recorded transaction is a no-op.

### 4.4 Freeze / unfreeze / cancel

All three share one private helper, `updateCardStatus(userId, cardId,
status)`, which looks the card up scoped to `userId` (so one user can never
touch another's card via a guessed id), calls
`stripe.issuing.cards.update(stripeCardId, { status })` against Stripe,
then mirrors the new status into `issued_cards`. Stripe's own Issuing
statuses are reused directly as this table's `status` enum:

| App action | Stripe `status` | Reversible? | Semantics |
|---|---|---|---|
| `freezeCard()` | `inactive` | Yes (→ `unfreezeCard()`) | Blocks new authorizations without giving up the card number |
| `unfreezeCard()` | `active` | — | Re-enables authorizations |
| `cancelCard()` | `canceled` | **No** | Terminal; Stripe does not allow un-canceling. Also what the webhook calls automatically on single-use auto-cancel (§4.3) |

### 4.5 Reveal — PCI-sensitive PAN/CVC retrieval

**No raw PAN, CVC, or expiry is ever requested by, or transits, this
app's server.** `issued_cards` only ever stores what Stripe's card object
already treats as non-sensitive. The reveal flow (`createCardEphemeralKey`
in `lib/stripe.ts`, called from `POST /api/cards/:id/reveal`):

1. Server calls `stripe.ephemeralKeys.create({ issuing_card: stripeCardId
   }, { apiVersion: STRIPE_API_VERSION })` — a short-lived (~30 min) key
   scoped to **exactly that one card**.
2. Server returns `{ stripeCardId, ephemeralKeySecret }` to the browser —
   this secret is the only sensitive-adjacent thing that ever leaves the
   server for this flow, and it is not itself the card number.
3. **Client-side only**, `components/reveal-card.tsx` uses `@stripe/stripe-js`
   (`loadStripe`, publishable key) to mount three Stripe.js **Issuing
   Elements** — `issuingCardNumberDisplay`, `issuingCardCvcDisplay`,
   `issuingCardExpiryDisplay` — passing them `issuingCard` +
   `ephemeralKeySecret`. Stripe.js decrypts and renders the real
   PAN/CVC/expiry **inside Stripe's own iframe**, never as a value this
   app's JS (let alone server) can read.

This is the standard Stripe-recommended pattern specifically so the
integration stays out of **PCI SAQ D** scope — the alternative,
`stripe.issuing.cards.retrieve(id, { expand: ["number", "cvc"] })` from a
server, is explicitly what Stripe advises against for anything but narrow,
compliance-reviewed cases, and this code never calls it.

**Flagged as unverified in `docs/CARDS.md`, confirmed still unresolved by
reading the code**: some Stripe accounts require an additional client-side
replay-protection nonce (`stripe.createEphemeralKeyNonce()`, threaded
through both the ephemeral-key creation call and the Element) on top of
the pattern implemented here. Neither `app/api/cards/[id]/reveal/route.ts`
nor `components/reveal-card.tsx` implement it — both the route and the
component carry comments saying to add it if Stripe's error message
requests a nonce, and that this has **not yet been exercised against a
real test-mode card**. This is a genuine open item, not resolved by
anything found elsewhere in the branch.

### 4.6 `simulate_purchase` — driving a real test-mode authorization

`simulatePurchase(userId, { cardId, amountCents, merchantName? })` (used
by both a potential future UI and the MCP `simulate_purchase` tool, §6):
calls `stripe.testHelpers.issuing.authorizations.create({ card, amount,
merchant_data })` — a **real** Stripe test-mode Issuing authorization
evaluated against that card's actual `spending_controls` and `status`, so
Stripe itself approves or declines, not application code. If approved, it's
immediately captured via
`stripe.testHelpers.issuing.authorizations.capture()`, which produces a
genuine `issuing_transaction.created` event handled by the same webhook
path as any real transaction (§4.3), single-use auto-cancel included. This
function does not duplicate that recording — it only drives Stripe's side
and returns the immediate approve/decline decision plus (if declined) the
last `request_history` entry's `reason`.

---

## 5. API routes

| Method | Path | Auth | Request body | Success response | Notes |
|---|---|---|---|---|---|
| `GET` | `/api/cards` | Session cookie | — | `200 { cards: IssuedCard[] }` | Scoped to `requireUser().id` |
| `POST` | `/api/cards` | Session cookie | `{ label: string, merchant?: string, spendingLimitCents?: number, phoneNumber?: string }` | `201 { card: IssuedCard }` | `label` required (400 if blank); `400 { error, phoneRequired: true }` if a brand-new cardholder needs a phone number (§4.1) |
| `POST` | `/api/cards/:id/cancel` | Session cookie | — | `200 { card }` | Terminal; scoped to caller's own card via `userId` in the underlying query |
| `POST` | `/api/cards/:id/freeze` | Session cookie | — | `200 { card }` | Sets Stripe + local status to `inactive` |
| `POST` | `/api/cards/:id/unfreeze` | Session cookie | — | `200 { card }` | Sets status back to `active` |
| `POST` | `/api/cards/:id/reveal` | Session cookie | — | `200 { stripeCardId, ephemeralKeySecret }` | Never returns PAN/CVC itself (§4.5) |
| `POST` | `/api/stripe/webhook` | **Stripe signature** (`stripe-signature` header, `STRIPE_WEBHOOK_SECRET`) — no session cookie, exempted in `middleware.ts` | Raw Stripe event JSON | `200 { received: true }` (also `200` on internal handling errors — see below) | See breakdown below |
| `GET` | `/api/auth/me` | None (reads cookie if present) | — | `200 { user: User \| null }` | |
| `POST` | `/api/auth/logout` | None | — | `200 { ok: true }` | Clears `vouch_session` with matching cookie options |
| `GET` | `/api/health` | None | — | `200 { ok: true, now, version }` / `500 { ok: false, error }` | Plain `select now(), version()` DB probe |
| `GET`/`POST`/`DELETE` | `/api/mcp` | **Bearer token** (MCP API key) — deliberately *not* in `middleware.ts`'s matcher | MCP Streamable HTTP protocol messages | MCP protocol responses | See §6 |
| `GET` | `/api/mcp/keys` | Session cookie | — | `200 { keys: McpApiKeySummary[] }` | Never returns the raw token |
| `POST` | `/api/mcp/keys` | Session cookie | `{ label?: string }` | `201 { id, label, token }` | Raw `token` shown **exactly once** |
| `POST` | `/api/mcp/keys/:id/revoke` | Session cookie | — | `200 { ok: true }` | Idempotent-ish (`where revoked_at is null`) |

Every authenticated route follows the same error contract:
`UnauthorizedError` → `401 { error: "Not authenticated" }`; anything else
unexpected → `console.error(...)` + `500 { error: "<generic message>" }`
(no internal error detail leaked to the client).

### `/api/stripe/webhook` in detail

```ts
export async function POST(req: NextRequest) {
  const signature = req.headers.get("stripe-signature");
  // 400 if missing
  const rawBody = await req.text();      // raw bytes, NOT req.json() — required for signature verification
  const event = verifyWebhookSignature(rawBody, signature); // throws -> 400 "Invalid signature"

  switch (event.type) {
    case "issuing_transaction.created":
      // -> recordCardTransaction(): inserts into card_transactions,
      //    auto-cancels the card if single-use + first transaction (§4.3)
      break;
    case "issuing_authorization.request":
      // no-op — see below
      break;
    default:
      break;
  }
  return NextResponse.json({ received: true }); // always 200, even if handling threw
}
```

Two events matter here, and they play very different roles:

- **`issuing_transaction.created`** — actively handled. This is what
  drives `recordCardTransaction()` (§4.3): inserts the transaction (amount
  is `Math.abs(txn.amount)`, since Stripe issuing amounts are negative for
  a spend/capture), and auto-cancels a single-use card on its first
  transaction.
- **`issuing_authorization.request`** — **subscribed to** (`docs/CARDS.md`
  setup step 4 tells you to subscribe the Stripe webhook endpoint to it)
  but the handler for it is a literal no-op (`break;`). The code comment
  is explicit about why: *"Stripe auto-approves an authorization against
  the cardholder's available balance/limits when this event isn't
  explicitly handled within its response-time window — that default is
  fine for now. Handling it here would let us approve/decline in real
  time (e.g. block anything but the one expected merchant on a single-use
  card), which is a natural next step, not yet built."* **In other words:
  real-time, application-level spend control (e.g. merchant allow-listing
  per card) is not implemented.** Spend control that *is* live and
  enforced comes entirely from Stripe's own synchronous evaluation of
  `spending_controls.spending_limits` (the `all_time` cap set at card
  creation, §4.3) and card `status` — both evaluated by Stripe itself at
  authorization time regardless of this webhook.

Handling failures inside the `switch` are caught, logged, and still
answered with `200` — the comment explains this is deliberate: a `200`
even after an internal failure prevents Stripe from retrying an event
whose failure is on this app's side (e.g. a transient DB error)
potentially forever; the `ON CONFLICT DO NOTHING` in
`recordCardTransaction` makes genuine retries safe to reprocess anyway.

---

## 6. The MCP server

This is the most distinctive part of this branch: the exact same card
lifecycle the human `/cards` UI drives is also exposed as a standards-based
[MCP](https://modelcontextprotocol.io) server, so any MCP-speaking client —
Claude, an OpenAI Agents SDK integration, or anything else — can issue,
list, freeze, unfreeze, cancel, and "spend from" cards on a user's behalf,
authenticated by its own bearer-token mechanism rather than the browser
session cookie. Introduced in a single commit, `3a90caf` ("Add an MCP
server exposing card issuance to Claude/OpenAI agents").

### 6.1 Architecture & transport

- **Library:** `@modelcontextprotocol/sdk` **1.30.0** (`McpServer` +
  `WebStandardStreamableHTTPServerTransport`).
- **Transport:** Streamable HTTP (the current MCP transport, not the
  legacy separate HTTP+SSE pair) over the Web Standard `Request`/`Response`
  objects — `app/api/mcp/route.ts` maps `GET`, `POST`, and `DELETE` to one
  `handle()` function, per the transport's expectations.
- **Statelessness:** `sessionIdGenerator: undefined` and
  `enableJsonResponse: true` — the transport does not track an MCP
  session across HTTP requests, and responses come back as plain JSON
  rather than an SSE stream. This matches the code comment: **a brand
  new `McpServer` and transport is constructed on every single HTTP
  request** (`buildMcpServer(user, ip)` in `lib/mcp/route.ts`'s handler),
  rather than one long-lived server instance — because this app runs on
  Vercel serverless functions, where nothing survives between
  invocations to keep a persistent MCP session alive anyway. Each
  request's tools close over that one request's authenticated `user` and
  client IP.

### 6.2 Tools exposed

All six tools are thin wrappers directly over the `lib/stripe.ts`
functions from §4 — no separate business logic lives in `lib/mcp/server.ts`
beyond input/output shaping with `zod`.

| Tool | Input (zod schema) | Wraps | `structuredContent` output |
|---|---|---|---|
| `create_temporary_card` | `label` (string), `merchant?`, `spending_limit_cents?` (positive int), `single_use?` (bool, default true), `phone_number?` | `createVirtualCard()` | `{ card }` or `{ phone_required: true }` on `PhoneNumberRequiredError` |
| `list_cards` | *(none)* | `listCards(user.id)` | `{ cards: IssuedCard[] }` |
| `freeze_card` | `card_id` | `freezeCard()` | `{ card }` |
| `unfreeze_card` | `card_id` | `unfreezeCard()` | `{ card }` |
| `cancel_card` | `card_id` | `cancelCard()` | `{ card }` |
| `simulate_purchase` | `card_id`, `amount_cents` (positive int), `merchant_name?` | `simulatePurchase()` (§4.6) | `{ approved, authorization_id, decline_reason? }` |

Every tool's `content` array also includes a short human-readable text
summary (e.g. `"Created card: Netflix: visa ····4242 (active)"`) alongside
the structured payload — useful for a chat-style agent surface that
renders tool text directly.

**Same PCI guarantee as the human UI, enforced identically for agents**:
`CARD_SHAPE` (the zod shape reused across every tool's card output) only
has `id, label, merchant, last4, brand, expMonth, expYear, status,
spendingLimitCents, singleUse` — **no field for the PAN or CVC exists in
any tool's output schema at all**. There is no "reveal" tool; an agent
cannot get the raw card number through MCP even if it wanted to — that
capability isn't wired up here, matching `docs/CARDS.md`'s framing that
`reveal` stays a human, browser-side, Stripe-Elements-only flow.

**What `simulate_purchase` is (and is not)**, worth stating precisely
since it's the tool that makes an agent's card *useful* rather than inert:
it drives a real Stripe test-mode Issuing authorization, so Stripe's own
approve/decline logic runs for real against that card's spend limit — but
Stripe Issuing authorizations are **pull-based** (a merchant/terminal
charges the card; nothing here can push a purchase to an arbitrary live
online merchant), and the whole branch is test-mode besides. So this
gives an agent a genuine, correctly-enforced "can I spend $X on this card"
answer, not a general "buy anything from any website" capability —
bridging to a real live checkout is explicitly out of scope here (would
need browser/checkout automation or a specific merchant's own payments
API).

### 6.3 Auth model: bearer API keys, not the session cookie

MCP clients aren't browsers and can't carry `vouch_session`. So `/api/mcp`
is deliberately **excluded** from `middleware.ts`'s matcher entirely (only
`/api/mcp/keys/*` — the key-management routes, used from a real logged-in
browser — is cookie-protected) and authenticates every request itself:

1. **Mint** (browser, session-authenticated): `POST /api/mcp/keys`
   (optional `{ label }`) → `createApiKey()` in `lib/mcp/api-keys.ts`
   generates `mcpk_<32 random bytes, base64url>`, stores **only its
   SHA-256 hash** (`mcp_api_keys.token_hash`, `unique`), and returns `{
   id, label, token }` — the raw token is visible **exactly once**, in
   this response. There is no way to retrieve it again afterward, by
   design (same treatment GitHub/Stripe give their own API keys).
2. **List / revoke** (browser, session-authenticated): `GET
   /api/mcp/keys` returns labels + timestamps only, never the token;
   `POST /api/mcp/keys/:id/revoke` sets `revoked_at = now()`.
3. **Use** (any MCP client): `Authorization: Bearer <token>` against
   `https://cards.getvouch.club/api/mcp`. `app/api/mcp/route.ts` parses
   the header, calls `verifyApiKey(token)` — SHA-256-hashes the presented
   token and looks it up by `token_hash` where `revoked_at is null` — then
   `getUserById()` on the resulting `user_id`. `verifyApiKey` also
   best-effort touches `last_used_at` (fire-and-forget; a failure there
   never blocks or fails the request). Every tool call in that request
   then runs as that specific user: `create_temporary_card` issues cards
   under *their* Stripe cardholder, `list_cards` only ever sees *their*
   cards, etc. — enforced the same way the human UI enforces it, by
   scoping every `lib/stripe.ts` query on `user.id` / `userId`.

### 6.4 Security assessment — what's solid, what's under-scoped

**What makes this reasonably safe as shipped:**
- Tokens are high-entropy (24 random bytes) and only ever stored hashed
  (SHA-256) — a DB read alone can't recover a usable token.
- Every tool call is scoped server-side to the key's owning user; there is
  no code path where one user's key can touch another user's cardholder or
  cards.
- The PCI boundary is enforced identically to the browser UI: no tool can
  return a PAN/CVC, and no "reveal" capability is exposed at all over MCP
  (§6.2).
- Keys are individually revocable and the raw value is never persisted in
  recoverable form (mirrors GitHub/Stripe's own PAT model).
- `simulate_purchase`'s "spend" capability is bounded by Stripe's own
  server-side `spending_controls` evaluation, not by anything an agent's
  own honesty guarantees.

**What's explicitly flagged as a gap — by the branch's own docs, confirmed
against the schema/code:**
- **Not OAuth.** This is a static, self-service bearer key (paste-once
  into an MCP client config), not the spec-preferred OAuth 2.1
  authorization-code flow a "Connect your Vouch account" one-click button
  in Claude.ai/ChatGPT's own UI would use. `docs/CARDS.md` calls this "a
  reasonable next step... just substantially more scope (an authorization
  server: dynamic client registration, consent screen, token exchange)
  than a first pass needed."
- **No rate limiting anywhere on `/api/mcp`.** Explicitly called out in
  `docs/CARDS.md`: "a compromised or overly-eager agent could mint cards
  or attempt authorizations in a tight loop." Confirmed in code — nothing
  in `app/api/mcp/route.ts` or `lib/mcp/server.ts` throttles calls per key
  or per user.
- **No key expiry.** `mcp_api_keys` (migration `0005`) has
  `created_at`/`last_used_at`/`revoked_at` but **no TTL/expiration
  column** — a minted key is valid forever until a human explicitly
  revokes it via the browser UI. Not called out in the branch's own docs;
  worth flagging as an additional gap on top of the two above.
- **No scoping within a key** — a single key grants *every* tool
  (`create_temporary_card`, `simulate_purchase` included), with no
  narrower "read-only" or "list-only" key type available. An agent
  integration that only needed to *read* card status has no way to be
  issued a key that can't also mint new cards or drive spend simulations.
- **No per-key audit trail beyond `last_used_at`** — no log of which tool
  was called, when, with what arguments, tied back to a specific key.

**Net assessment:** the auth boundary itself (bearer token → hashed →
scoped-by-user) is sound and standard for a first-pass developer-facing
integration, and the PCI boundary is not weakened for agents versus
humans. The main product-level exposure is **blast radius per leaked key**
— a leaked, non-expiring, unscoped, unrate-limited token lets a caller
mint and spend against a user's real cardholder indefinitely (bounded only
by whatever `spending_controls` that caller sets per card, and by this
whole branch currently running in Stripe test mode). That combination is
reasonable for "a single developer wiring up their own MCP client" (the
stated current use case) but would need the OAuth flow, rate limiting, and
ideally key expiry/scoping before being handed to a broad, less-trusted
population of third-party agent integrations.

### 6.5 What this means for the product

Concretely: **an agent that never opens Vouch's own `/cards` UI can mint a
disposable virtual card and get a real, Stripe-enforced approve/decline
answer against it, entirely through a conversation with an LLM.** For the
product's stated purpose (Vouch is described in root `ARCHITECTURE.md` as
"an AI agent that manages recurring subscriptions"), this is a second
front door onto the same capability the dashboard's own agent loop uses —
the MCP server doesn't add a new capability so much as expose the existing
one through a protocol-standard interface any agent runtime can speak,
instead of only Vouch's own first-party UI/backend. That is deliberate
(MCP is called out as "a protocol, not a vendor-specific integration... one
server, not two" for Claude vs. OpenAI clients) and is the piece of this
branch most worth a second look before wider rollout, per §6.4.

---

## 7. Database schema

All 5 migrations on this branch, applied in filename order by
`scripts/migrate.mjs` (tracked in a `_migrations` table; no down-migrations
by design). Reproduced verbatim.

Note on cross-branch dependency: `issued_cards`/`card_transactions`/
`stripe_cardholders`/`mcp_api_keys` all reference `users(id)`, but the
`users` table itself is **not created by this branch** — it's owned by
`bank-connection`'s `0002_users.sql` (`id, email, password_hash,
created_at`). This branch's migrations rely on that table already existing
in the shared database, while deliberately avoiding any hard foreign key
into another *service's* tables (e.g. `gmail-connector`'s
`gmail_messages`) so this branch's own migrations "stay applicable to a
fresh database on their own."

### `0001_stripe_cardholders.sql`

```sql
-- Maps each Vouch user to a Stripe Issuing Cardholder, since Stripe scopes
-- card issuance per-cardholder. Created lazily on first card request, one
-- per user, same pattern as gmail-connector's backboard_assistants.
create table if not exists stripe_cardholders (
  user_id text primary key references users(id) on delete cascade,
  stripe_cardholder_id text not null unique,
  created_at timestamptz not null default now()
);
```

### `0002_issued_cards.sql`

```sql
-- Virtual cards issued via Stripe Issuing (test/sandbox mode). No PAN/CVC
-- ever lands in this table or anywhere on our server — those are revealed
-- client-side only, via a short-lived Stripe ephemeral key + Stripe.js
-- Issuing Elements (see docs/CARDS.md "PCI scope"). This table only ever
-- stores what Stripe's own card object already treats as non-sensitive
-- (last4, brand, expiry, status).
create table if not exists issued_cards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  stripe_card_id text not null unique,
  -- User-facing nickname, e.g. "Netflix" -- freeform, not tied by a hard
  -- foreign key to any other service's tables (gmail-connector's
  -- gmail_messages included), since this branch's own migrations must
  -- stay applicable to a fresh database on their own.
  label text not null default '',
  merchant text,
  last4 text not null,
  brand text not null,
  exp_month smallint not null,
  exp_year smallint not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'canceled')),
  spending_limit_cents integer,
  -- Default true: one disposable card per transaction is the standard
  -- issuance model here, not the exception. The webhook handler
  -- (app/api/stripe/webhook/route.ts) auto-cancels a single-use card the
  -- moment its first transaction posts, so a merchant can never charge it
  -- again -- kills a subscription by construction, no manual cancel step.
  single_use boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists issued_cards_user_id_idx on issued_cards (user_id);
```

### `0003_card_transactions.sql`

```sql
-- Populated from Stripe's issuing_transaction.created webhook (see
-- app/api/stripe/webhook/route.ts) -- a local read model of spend per
-- card, so the UI doesn't need a live Stripe API call just to show
-- transaction history.
create table if not exists card_transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references issued_cards(id) on delete cascade,
  stripe_transaction_id text not null unique,
  amount_cents integer not null,
  merchant_name text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists card_transactions_card_id_idx on card_transactions (card_id, occurred_at desc);
```

### `0004_users_name.sql`

```sql
-- lib/auth.ts's getUserById() selects `name` from `users`, but no
-- migration anywhere in this repo ever added that column -- bank-connection's
-- 0002_users.sql (where `users` is created) only has id/email/password_hash/
-- created_at. That means getUserById() -- called on every authenticated
-- request via lib/session.ts -- would fail with "column users.name does not
-- exist" the moment it actually ran. Caught while wiring the dashboard
-- branch's own copy of this same query against real user data.
alter table users add column if not exists name text not null default '';
```

### `0005_mcp_api_keys.sql`

```sql
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
```

### Table summary

| Table | Owner (this branch) | Key columns | Purpose |
|---|---|---|---|
| `stripe_cardholders` | card-issuing | `user_id` PK/FK → `users`, `stripe_cardholder_id` unique | One Stripe Issuing Cardholder per Vouch user |
| `issued_cards` | card-issuing | `id` PK, `user_id` FK, `stripe_card_id` unique, `status` check-constrained | One row per virtual card; no PAN/CVC ever |
| `card_transactions` | card-issuing | `id` PK, `card_id` FK → `issued_cards`, `stripe_transaction_id` unique | Local read model of posted spend, from webhook |
| `mcp_api_keys` | card-issuing | `id` PK, `user_id` FK, `token_hash` unique | Bearer tokens for MCP auth, hash-only |
| `users.name` | *(alters `bank-connection`'s table)* | — | Column this branch needs but doesn't own the table for (§11) |

---

## 8. How `card_transactions` gets populated: webhook-driven, not polled

Exclusively **webhook-driven** — there is no polling code anywhere on this
branch (no cron, no `setInterval`, no scheduled Vercel function, no
`stripe.issuing.transactions.list()` call outside the webhook path).

The only writer is `recordCardTransaction()` (`lib/stripe.ts`), called
from exactly one place: the `issuing_transaction.created` case in
`app/api/stripe/webhook/route.ts` (§5). Flow: a test-mode purchase is
simulated (Stripe Dashboard "Simulate authorization", `stripe
testHelpers.issuing.authorizations.create` via the CLI/API, or the MCP
`simulate_purchase` tool, §6.2) → Stripe approves + captures → Stripe fires
`issuing_transaction.created` at the configured webhook endpoint → this
route verifies the signature, looks up the local card by
`stripe_card_id`, inserts into `card_transactions` (idempotently, via the
unique-constraint + `ON CONFLICT DO NOTHING` pattern in §4.3), and — if
this was a single-use card's first transaction — cancels it via the Stripe
API in the same call. The UI (`card-manager.tsx`) never needs a live
Stripe API call to show transaction history as a result — it's a pure
local read model, at the cost of only being as fresh as Stripe's webhook
delivery.

(`issuing_authorization.request`, the *pre*-transaction event, is
subscribed to but not acted on — see §5's breakdown; it does not write to
`card_transactions`, since capture, not authorization, is what actually
posts a transaction.)

---

## 9. Environment variables

Cross-referenced: every `process.env.*` read in the branch (via `git grep`)
against `.env.example` — **all match 1:1**, nothing is read without also
being documented in the template, and nothing in the template goes unread.

| Variable | Purpose | Where read | Public? |
|---|---|---|---|
| `DATABASE_URL` | Shared Postgres (Tiger Cloud / GCP Cloud SQL) connection string, same DB every service branch uses | `lib/db.ts`, `scripts/migrate.mjs` | Server-only |
| `JWT_SECRET` | Verifies the `vouch_session` JWT issued by the `portal` branch — must be byte-identical across branches | `lib/session-token.ts` | Server-only |
| `SESSION_COOKIE_DOMAIN` | Cookie domain (`.getvouch.club`) so the session is readable by every subdomain; unset → host-only cookie for local dev | `lib/session-token.ts` (`sessionCookieOptions()`) | Server-only |
| `PORTAL_LOGIN_URL` | Where an unauthenticated **page** request gets redirected — this branch has no login UI of its own | `middleware.ts` | Server-only |
| `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Same URL, for the client-side logout redirect | `app/cards/page.tsx` | **Public** (inlined at build time) |
| `ENCRYPTION_KEY` | AES-256-GCM key for `lib/crypto.ts`, shared across every service branch for consistency | `lib/crypto.ts` | Server-only — **but see §10: nothing on this branch actually calls `encryptSecret`/`decryptSecret`** |
| `STRIPE_SECRET_KEY` | Stripe API secret key, test mode (`sk_test_...`) | `lib/stripe.ts` | Server-only |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe.js publishable key (`pk_test_...`), used client-side to mount Issuing Elements | `components/reveal-card.tsx` | **Public** by design (this is what publishable keys are for) |
| `STRIPE_WEBHOOK_SECRET` | Verifies the `stripe-signature` header on `/api/stripe/webhook` (`whsec_...`) | `lib/stripe.ts` (`verifyWebhookSignature`) | Server-only |
| `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID` | The `fa_test_...` financial account every card creation call must name (§4.2) | `lib/stripe.ts` (`getIssuingFinancialAccountId`) | Server-only |

Not in `.env.example` but also read: `NODE_ENV` (`lib/session-token.ts`,
standard Next.js/Vercel-provided var — only sets the cookie's `secure`
flag in production, not something to configure manually).

---

## 10. Encryption & data-at-rest / PCI summary

Direct answer to "is any card-related data encrypted at rest": **no card
data is encrypted at rest, because no sensitive card data is stored at
all** — the security model here is *don't persist it*, not *persist it
encrypted*.

- **`lib/crypto.ts`** exports `encryptSecret`/`decryptSecret`
  (AES-256-GCM, `iv:authTag:ciphertext` all base64, keyed by
  `ENCRYPTION_KEY`) — the same helper root `ARCHITECTURE.md` §8 says is
  used elsewhere for genuinely sensitive at-rest values (voice embeddings,
  Plaid access tokens, on other branches). **Verified by `git grep`: on
  this branch, `encryptSecret`/`decryptSecret` are defined but never
  imported or called anywhere** — `.env.example`'s own comment on
  `ENCRYPTION_KEY` says as much ("Not currently used for anything stored
  by this branch... but kept for consistency with `lib/crypto.ts`, which
  every service branch carries"). This is effectively dead code on this
  branch today, present only so the branch matches the shared-file
  convention other services follow.
- **What `issued_cards` actually persists**: `last4`, `brand`, `exp_month`,
  `exp_year`, `status`, plus app-level metadata (`label`, `merchant`,
  `spending_limit_cents`, `single_use`) and the Stripe object id
  (`stripe_card_id`). Every one of these is a field Stripe's own card
  object already classifies as non-sensitive — none of it requires
  encryption to be handled safely, and Stripe's own docs treat `last4`/
  `brand`/expiry as fine to store and display in plaintext.
  `db/migrations/0002_issued_cards.sql`'s own header comment states this
  explicitly: "No PAN/CVC ever lands in this table or anywhere on our
  server."
- **The full PAN/CVC/expiry** are never fetched to the server at all
  (§4.5) — they exist, in cleartext, only transiently inside Stripe's own
  client-side iframe (Stripe.js Issuing Elements), scoped by a ~30-minute
  ephemeral key. There is nothing server-side to encrypt because the
  server never possesses the value in the first place — a stronger
  guarantee than encryption-at-rest would provide.
- **MCP API keys are hashed, not encrypted** — a distinct mechanism from
  `lib/crypto.ts`. `lib/mcp/api-keys.ts` uses Node's `crypto.createHash("sha256")`
  directly (one-way hash, like a password), not `lib/crypto.ts`'s
  reversible AES-GCM — correct, since nothing ever needs to recover the
  raw token server-side; only compare-by-hash on each request matters.

**Net PCI-scope conclusion** (matching `docs/CARDS.md`'s own framing,
confirmed by reading every persistence point in the branch): this app
never enters possession of cardholder data covered by PCI SAQ D, because
`issued_cards` genuinely never stores it and the one place raw card data
*is* displayed (`reveal`) is architected to bypass the server entirely.

---

## 11. Notable history — what the two "Fix" commits reveal

### `d5d5294` — "Fix real Stripe Issuing requirements found via live testing"

Already covered in detail in §4.1–§4.2; the commit's own message frames it
well: *"Everything here was discovered empirically against a real
test-mode account, not documented anywhere found at the time."* Touched
`.env.example` (+`STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID`),
`app/api/cards/route.ts` (+IP threading, +`PhoneNumberRequiredError`
handling), `components/card-manager.tsx` (+one-time phone prompt),
`docs/CARDS.md` (+"Financial account" and "Cardholder requirements"
sections), and `lib/stripe.ts` (+`splitName`, +`PhoneNumberRequiredError`,
+`individual.{first_name,last_name,card_issuing.user_terms_acceptance}`,
+the `financial_account_v2` untyped spread). This is the commit that took
the integration from "matches the docs' minimal example" to "actually
works against a real account" — every requirement in §4.1's table traces
back to an error message this commit's diff is a direct response to.

### `c6dacf1` — "Fix missing users.name column referenced by lib/auth.ts"

A one-file, 8-line fix (`db/migrations/0004_users_name.sql`), but
diagnostically interesting: `lib/auth.ts`'s `getUserById()` — called on
**every single authenticated request** via `lib/session.ts` — selects
`name` from `users`, but no migration on *any* branch had ever added that
column; `bank-connection`'s `0002_users.sql` (confirmed by reading it
directly) only defines `id, email, password_hash, created_at`. The commit
message is explicit that this had been silently broken all along and was
only "caught while wiring the dashboard branch's own copy of this same
query against real user data — not something the card flow had exercised
successfully end-to-end yet (blocked separately on Stripe financial
account provisioning" — i.e., §4.2's `status: pending` Financial Account
issue had been masking this bug, because no authenticated request had
actually completed a full round-trip through `getUserById()` in anger
until a *different* branch's testing exposed it.

**Why this matters for KYC/cardholder identity** (per the task's framing):
`users.name` is exactly what `lib/stripe.ts`'s `splitName()` (§4.1) needs
to populate Stripe's required `individual.first_name`/`last_name` on
cardholder creation — so this column isn't incidental plumbing, it's a
direct dependency of Stripe's cardholder KYC requirement. Without it, the
app-level bug (`column users.name does not exist`) would have masked
itself as, or been masked by, Stripe-level cardholder failures, making
this exact bug plausible to misdiagnose as a Stripe-side issue rather than
a missing local migration.

---

## 12. Known gaps (consolidated)

Pulled from `docs/CARDS.md`'s own admissions, this branch's code comments,
and this review's own findings (§6.4), in one place:

- **Reveal nonce**: possibly-required `stripe.createEphemeralKeyNonce()`
  step not implemented, not yet exercised against a real test-mode card
  (§4.5).
- **Real-time per-authorization spend control** (merchant allow-listing,
  etc. via `issuing_authorization.request`) is not implemented — Stripe's
  default auto-approval-within-`spending_controls` is what's actually
  live (§5).
- **MCP: no OAuth 2.1 flow**, static bearer keys only (§6.4).
- **MCP: no rate limiting** on `/api/mcp` (§6.4, explicitly flagged in
  `docs/CARDS.md`).
- **MCP: no key expiry or per-key scoping** — every key can call every
  tool, forever, until manually revoked (§6.4, this review's own finding).
- **Cardholder terms acceptance is an implicit side effect** of clicking
  "Generate a card," not an explicit checkbox — flagged in the code itself
  as needing to change before any non-sandbox launch (§4.1).
- **Billing address is a hardcoded placeholder** for every cardholder,
  not collected from the user — same "fix before production" flag (§4.1).
- **Only individual cardholders are supported** — no company-type path
  (§4.1).
- **Stripe Issuing Financial Account provisioning latency**: the sandbox
  Financial Account can sit in `status: pending` with no documented way to
  force it or inspect why (§4.2) — confirmed as still the state described
  in root `ARCHITECTURE.md` §7 at the time both were read.
