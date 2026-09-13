# Dashboard

Ports the `kbhatnagar1506/vouch-ui` hackathon UI (HackRice 16, Fintech
track) into this repo as two routes on the `dashboard` branch:

- **`/dashboard`** — real data, protected by the shared session cookie
  (see root `CLAUDE.md` "Service branches"). Reads from every other
  service branch's tables in the shared DB.
- **`/demo`** — public, unauthenticated, and renders the exact same UI
  with vouch-ui's original mock data (`lib/seed.ts`, ported verbatim).
  Mirrors this repo's existing `/voice` (demo) vs `/voice/register`
  (real) split.

Both routes render the same `components/dashboard/*` components via
`<DashboardShell mode="demo" | "real" .../>`.

## What's real vs. what's stubbed

The dashboard needs an AI decision engine and usage tracking that don't
exist in this codebase. Rather than fabricate them, `/dashboard` uses only
signals that are actually measured, and is explicit in the UI (and here)
about what's missing:

| Concept | vouch-ui original | `/dashboard` (real) |
|---|---|---|
| Subscriptions | Hardcoded 5-item seed | Distinct merchants from `gmail_messages` classified `subscription_signup_renewal` (see gmail-connector), merged with `issued_cards` (see card-issuing) by merchant name |
| Usage (plays/rides/hours) | Seeded numbers | **Not shown.** No usage-tracking integration exists for any service. `usage30`/`usageUnit`/`trend` stay `undefined` rather than guessed (`lib/dashboard-types.ts`) |
| Renew/hold/cancel verdict | `analyze()` in Analysis.jsx, entirely usage-derived | `lib/analyze-real.ts` — rule-based on price change vs. the previous Gmail-recorded charge, whether an active single-use card exists, and days until the next expected charge (last charge + 30-day assumed cycle). Never outputs verdict `Cancel`: nothing here measures whether a service is worth keeping, only whether its price moved or a card is missing |
| "Worth $X/mo" value estimate | Usage vs. price | **Omitted.** Inherently usage-derived; `Analysis`'s `worth`/`valuePct` fields stay `undefined` and `components/dashboard/Analysis.tsx` renders a narrower row (`.analysis-row.no-worth`) without that column |
| Budget cap | Arbitrary `$120` | Last month's real spend (`monthlyCap`), so "of budget" reads as "vs last month" instead of a limit nobody set |
| Budget vs actual (per category) | Arbitrary per-category caps | Last month's real spend in that category (from the same Gmail data), so the comparison is real month-over-month, not an invented limit |
| "Subs / income" | Seeded `monthlyIncome` | **Omitted** — Plaid gives balances, not income. Replaced with "This month" spend |
| Category labels (Streaming, AI & tools, ...) | Seeded per subscription | Looked up from the static brand catalog (`lib/catalog.ts`, ported from vouch-ui) by matching the real merchant name — this is brand metadata, not user data, so reusing it isn't fabrication |
| Transactions | Seeded, incl. a "declined" example and "Claude MCP" framing | `card_transactions` (see card-issuing) — real posted charges only. No declines are recorded anywhere yet, so `kind` is always `"out"` |
| Connectors | 10 seeded (Lithic, Claude, OpenAI, Gemini, Backboard, Tiger Data, ElevenLabs, ...) | 5 real ones this repo actually has: Stripe, Bank (Plaid), Gmail, Backboard, Voice — each `connected`/`action` from a real row existing in `gmail_connections` / `plaid_items` / `backboard_assistants` / `voice_enrollments` |
| Settings → Issuer | "Lithic · sandbox" | "Stripe · sandbox" (this repo issues cards via Stripe Issuing, see card-issuing's `docs/CARDS.md`) |
| Settings → Decision mode / tone toggles | Same | Kept as local UI state (never wired to anything in the original either) with a note that the current build always uses the rule-based logic above |

`/demo` keeps every one of these exactly as vouch-ui had them — it's the
full-featured showcase, not a second real surface.

## Data sources (real mode)

`lib/dashboard-data.ts` assembles one `DashboardData` object per request
from tables owned by other service branches (all in the one shared DB —
see root `CLAUDE.md`):

- `gmail_messages` + `gmail_message_classifications` (gmail-connector)
- `issued_cards` + `card_transactions` (card-issuing)
- `plaid_accounts` + `plaid_items` (bank-connection)
- `gmail_connections`, `backboard_assistants` (gmail-connector)
- `voice_enrollments` (voice-verification)

A subscription is keyed by normalized merchant name and merged from
whichever of {a Gmail charge history, an issued card} exist for it — a
card minted with no Gmail history yet (or vice versa) still shows up.

## Minting and canceling cards

"Mint card & renew" / "Keep it dead" in the popup call
`app/api/dashboard/resolve/route.ts`, which uses `lib/stripe-mint.ts` — a
trimmed, self-contained copy of card-issuing's `lib/stripe.ts` (per this
repo's no-shared-code-across-branches convention), covering just
cardholder setup + mint + cancel. Cards minted here land in the same
`issued_cards` table and Stripe account as card-issuing, so **card-issuing's
webhook** (already deployed there) still auto-cancels them on their first
transaction — nothing extra to deploy on this branch for that. A
first-ever mint still needs a phone number (Stripe requirement for 3D
Secure); the popup collects it inline, same UX as card-issuing's card
manager.

## Call me (proxies to the `calling-agent` branch)

The Sidebar's "Call me" button places a real outbound call that reads out
whatever currently needs a decision — the thing the popup's own
voice-hint line already promises. This branch does **not** talk to Vapi
directly: `app/api/dashboard/call-me/route.ts` forwards the request to
the `calling-agent` branch's own deployment (`POST
/api/calling-agent/calls`), which owns the actual Vapi/ElevenLabs
integration, the assistant, and call history — see that branch's
`docs/CALLING_AGENT.md`. This keeps with the "one service, one branch"
convention: card issuance lives on `card-issuing`, calling lives on
`calling-agent`, and `dashboard` is a thin client to both.

The forward re-sends the caller's own session cookie as a header on the
server-to-server request — both branches verify the same `JWT_SECRET`,
so `calling-agent`'s `requireUser()` resolves the identical user without
any separate auth between the two services. The call is placed with
`purpose: "purchase_verification"` (calling-agent's preset for "confirm
this transaction with the cardholder"), passing the subscriptions
currently needing a decision as free-text `context`.

Needs `CALLING_AGENT_URL` (see `.env.example`) pointing at that branch's
deployment. Until it's set, this returns a clear 501 "not configured"
error rather than crashing — same treatment card-issuing got before its
Stripe keys existed.

In `/demo`, the button runs the same UI flow (asks for a number if it
doesn't have one, shows "Calling…" then "Calling you now") without ever
reaching the network — there's no real user to call.

## UI polish

- **Page transitions**: switching sidebar tabs re-mounts the page content
  under a `key`, replaying a short fade/slide-in (`.page-transition` in
  `app/globals.css`). Respects `prefers-reduced-motion`.
- **Loading skeleton**: `app/dashboard/loading.tsx` is Next.js's automatic
  Suspense fallback for `/dashboard`'s async data fetch — no client JS,
  shown for however long `getRealDashboardData` takes, laid out to match
  the real shell so nothing shifts when it swaps in.
- **Mint/cancel success state**: `CardPopup` swaps its body for a brief
  checkmark + confirmation (`.popup-success`) before auto-closing, in both
  modes — demo included, since there's nothing to actually mint/cancel
  there but the moment is still worth showing off.

## Fixed while building this: missing `users.name` column

`card-issuing/lib/auth.ts` (and this branch's copy) select `name` from
`users`, but no migration had ever added that column — `bank-connection`'s
`0002_users.sql` only has `id`/`email`/`password_hash`/`created_at`. That
would fail with "column users.name does not exist" the moment
`getUserById()` ran. Fixed here (`db/migrations/0001_users_name.sql`) and
on `card-issuing` with the same idempotent migration.

## Environment variables

See `.env.example`. `STRIPE_SECRET_KEY` / `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID`
are the same test-mode values already configured on the `card-issuing`
branch's Vercel Preview environment.
