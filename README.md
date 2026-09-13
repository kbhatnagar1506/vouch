# Vouch

**Temporary cards for AI agents.**

Hand an agent your card and you've handed it your card: every merchant, every
amount, forever. Vouch hands it a virtual card scoped to one purchase instead,
with a spending limit Stripe enforces, that cancels itself the moment its first
transaction posts.

Your agent needs a $20–30 Uber from Atlanta to Houston? It asks Vouch over MCP,
gets a card capped at $30, spends it once, and the card is dead before it can be
used anywhere else. Your real number was never in the conversation.

The same mechanism kills subscriptions. Every renewal gets its own single-use
card, so the next charge is declined at the network before it reaches a
retention flow. You don't cancel the subscription. The card stops existing.

Around that sits an agent that reads your receipts, works out what's worth
keeping, phones you to confirm anything it's unsure about, and proves it's
really you before it spends a cent.

**Live:** [getvouch.club](https://getvouch.club) ·
**Dashboard demo (no login):**
[dashboard.getvouch.club/demo](https://dashboard.getvouch.club/demo)

---

> **You're on `main`, which is a reading branch.** It isn't deployed anywhere.
> Every service's full source is snapshotted under [`services/`](services/) so
> the whole system can be read without checking out eight branches, and
> [`services/README.md`](services/README.md) points at the files worth reading
> first. The service branches are the source of truth and the only thing that
> ships.
>
> Also here: [`ARCHITECTURE.md`](ARCHITECTURE.md) for the deeper technical
> walkthrough, and [`DEVPOST.md`](DEVPOST.md) for the submission write-up.

## What it actually does

1. **Connect Gmail.** Receipts and renewal notices are pulled, embedded,
   classified into spending categories, and written to two memory stores —
   local pgvector tables and a per-user [Backboard](https://backboard.io)
   assistant. Classification has to run first (everything downstream keys off
   its category), but the two memory writes are independent and run
   concurrently.
2. **See what you're actually paying for.** The dashboard derives subscriptions
   from real classified email, real issued cards, and real bank balances. The
   renew / hold / ask decision is **rule-based, not an LLM** — deliberately, so
   the reason shown is the reason used.
3. **Mint a card per charge.** Stripe Issuing, single-use by default,
   auto-cancelled by the `issuing_transaction.created` webhook the instant its
   first transaction posts.
4. **Get a phone call when it's unsure.** An outbound voice agent (Vapi +
   ElevenLabs + Gemini) rings you, greets you by time of day, summarises the
   month, pulls your past payment history from Backboard, and asks about the
   renewal.
5. **Prove it's you.** A speaker-verification model matches the caller against
   your enrolled voiceprint, and [Persona](https://withpersona.com) government
   ID + selfie liveness is what gives that voiceprint an identity.
6. **Let an agent do it.** The card lifecycle is exposed over **MCP**, so Claude
   — or any MCP-speaking agent — can mint, freeze and cancel cards for you.

## The idea worth stealing

Most of this is plumbing. Two decisions are not:

**Identity verification is a capability unlock, not a signup toll.** Nobody is
asked for ID to look around. You're asked at the moment the agent is about to
*spend your money*, where the reason is self-evident. Unverified, the agent can
only observe; verified, it can act. Same check, moved to where it makes sense —
and cheaper, since IDV is billed per verification.

**One ID check upgrades every future phone call.** A voiceprint alone proves
*consistency* — the caller matches whoever enrolled. It says nothing about who
that is; anyone can sign up and enroll their own voice. Capture the voice in
the same session as a government ID check and store the inquiry id against the
enrollment, and every later speaker-match inherits that check. Two independent
biometrics — face and voice — anchored to one verified identity, used at
different moments. You pay for identity once and get identity-grade assurance
on unlimited calls after it.

## Architecture

One repo, one Postgres, one session cookie. Each service is a long-lived branch
deployed to its own subdomain via Vercel Git Branch Domains — no microservice
orchestration, no separate projects, and every service reachable at a real URL.

```
                      ┌──────────────┐
  login.getvouch.club │    portal    │  issues the vouch_session JWT
                      └──────┬───────┘  on .getvouch.club
                             │
   ┌──────────┬──────────────┼──────────────┬───────────────┐
   ▼          ▼              ▼              ▼               ▼
 gmail      bank           cards          voice          identity
 Gmail →    Plaid          Stripe         ECAPA-TDNN     Persona
 embed →    accounts       Issuing        speaker        gov ID +
 classify   balances       + MCP          verification   selfie
 → memory                  server
   │          │              │              │               │
   └──────────┴──────────────┼──────────────┴───────────────┘
                             ▼
                   dashboard.getvouch.club
                   real subscriptions, cards,
                   budget, transactions
                             │
                             ▼
                   callingagent.getvouch.club
                   Vapi + ElevenLabs + Gemini
```

Every branch verifies the same `JWT_SECRET`, so the portal's cookie is a valid
session on all of them — cross-service calls just forward it server-side.

| Branch | Subdomain | What it owns | Docs |
|---|---|---|---|
| `claude/vigilant-meitner-fxqi9c` | — | production base | this file |
| `portal` | `login` | signup/login, issues the session | — |
| `gmail-connector` | `gmail` | Gmail sync, embeddings, classification, memory | [GMAIL.md](services/gmail-connector/docs/GMAIL.md) |
| `bank-connection` | `bankconnection` | Plaid link, accounts, balances | [PLAID.md](services/bank-connection/docs/PLAID.md) |
| `card-issuing` | `cards` | Stripe Issuing, webhooks, **MCP server** | [CARDS.md](services/card-issuing/docs/CARDS.md) |
| `voice-verification` | `voice` | voice enrollment + speaker matching | [VOICE.md](services/voice-verification/docs/VOICE.md) |
| `identity-verification` | `identity` | Persona ID + selfie, the voice binding | [IDENTITY.md](services/identity-verification/docs/IDENTITY.md) |
| `calling-agent` | `callingagent` | outbound voice calls | [CALLING_AGENT.md](services/calling-agent/docs/CALLING_AGENT.md) |
| `dashboard` | `dashboard` | the real dashboard + `/demo` | [DASHBOARD.md](services/dashboard/docs/DASHBOARD.md) |

## The MCP server

`card-issuing` exposes card issuance as an MCP server over Streamable HTTP, so
an agent can spend on your behalf under limits you set:

`create_temporary_card` · `list_cards` · `freeze_card` · `unfreeze_card` ·
`cancel_card` · `simulate_purchase` · `create_checkout` · `void_checkout`

MCP clients aren't browsers and can't carry the session cookie, so this endpoint
authenticates with its own revocable bearer keys — SHA-256 hashed, shown once at
creation, mintable from the **Agent access** panel on `/cards`.

```sh
claude mcp add --transport http vouch-cards \
  https://cards.getvouch.club/api/mcp \
  --header "Authorization: Bearer mcpk_..."
```

**No tool ever returns a card number** for a Stripe-issued card. The PAN stays
out of the server entirely and is revealed client-side through a short-lived
ephemeral key. `simulate_purchase` drives a real test-mode authorization against
the card's own `spending_controls`, so **Stripe** decides approve/decline, not
our code.

## Built with

**Next.js 15** (App Router) · **TypeScript** · **PostgreSQL** (Cloud SQL) +
**pgvector** · **Vercel** · **Stripe Issuing** · **Plaid** · **Gmail API** ·
**Backboard** · **Vapi** · **ElevenLabs** · **Google Gemini** ·
**Persona** · **Model Context Protocol** · **ECAPA-TDNN** + **AASIST**
(SpeechBrain, FastAPI on Cloud Run) · **Vitest** · **Playwright**

## What's real and what isn't

Worth being precise about, because "it's a demo" usually hides this:

- **Real:** Gmail sync and classification, pgvector embeddings, Backboard
  memory, Plaid balances, Stripe cardholders, the MCP server and its auth,
  outbound phone calls (really dials, really transcribes, really extracts
  structured data), speaker verification against an enrolled voiceprint,
  Persona's flow and webhook signature verification.
- **Stubbed, and labelled as such in the UI:** per-service usage numbers
  (nothing in the stack measures how much you use Netflix, so the real
  dashboard leaves those fields empty rather than inventing them — only
  `/demo` shows them, from seed data).
- **Blocked on a third party:** the Stripe Issuing Financial Account is stuck
  `pending`, so live card creation returns `You cannot create a new card ...
  because its status is pending`. `CARD_ISSUING_MODE=mock` stands in so the
  rest of the loop stays exercisable; the code path for real issuance is
  written and unchanged.

The real dashboard never fabricates a number. Where there's no data, it says so.

## Running it

Each branch is a standalone Next.js app sharing one database.

```sh
git clone https://github.com/kbhatnagar1506/vouch.git
cd vouch
git checkout dashboard        # or any service branch
npm install
cp .env.example .env          # every var is documented inline
npm run db:migrate
npm run dev
```

`npm test` runs the Vitest suites (`gmail-connector`, `dashboard`,
`identity-verification`). Each branch's `.env.example` explains every variable
and where to obtain it; the per-service docs above cover setup, data model, and
the reasoning behind the tricky parts.

## Things that cost us a day

- **ElevenLabs returns HTTP 402 for Voice Library voices on a free plan**, and
  Vapi surfaces it only as `pipeline-error-eleven-labs-voice-failed` — calls
  died five seconds in with an empty transcript. The voice id was fine and
  listed on the account; the *plan* was the blocker. Synthesizing directly
  against ElevenLabs is what separated plan (402) from key (401).
- **Backboard 500s on any non-integer float in metadata**, and caps content at
  4096 UTF-8 *bytes* — not characters, so one smart quote in an email body
  shifts the boundary.
- **Vercel "Secret" env vars are write-only.** Once set they can never be read
  back by anyone, which quietly rules out pulling `DATABASE_URL` locally to run
  a migration.
- **Persona's `completed` does not mean verified.** It means the user reached
  the last screen. Only `approved` reflects the checks actually passing —
  gating on the wrong one would admit anyone who walked to the end of the flow.
