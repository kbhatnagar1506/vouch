# Vouch — architecture and tech stack

One repo, one database, one session cookie, eight deployed services.

Vouch is an AI agent that manages recurring subscriptions. It reads your
receipt and renewal emails, decides whether each subscription is worth
keeping, mints a **single-use virtual card** for the ones you renew, and
**phones you** to confirm a charge before money moves.

The organising idea of the codebase: **the agent spends real money, so every
input to that decision has to be real too.** Most of what follows is about
closing the gap between "the user typed this" and "we verified this."

---

## 1. The shape of the system

Each onboarding step is its own **long-lived git branch**, deployed to its
own **subdomain**, all from one GitHub repo and one Vercel project. They
share one Postgres database, one session cookie, and one `JWT_SECRET`.
Branches never import code from each other — shared logic (`lib/db.ts`,
session handling, `lib/crypto.ts`) is **copied** per branch, so no branch can
break another by changing a shared file.

| Branch | Subdomain | Does |
|---|---|---|
| `portal` | `login.getvouch.club` | Sign-up / login. The only issuer of sessions. |
| `gmail-connector` | `gmail.getvouch.club` | Gmail OAuth, email sync, classification, memory |
| `bank-connection` | `bankconnection.getvouch.club` | Plaid bank linking (skippable) |
| `voice-verification` | `voice.getvouch.club` | Voice enrollment + speaker verification |
| `identity-verification` | `identity.getvouch.club` | Persona ID + selfie liveness *(not yet bound)* |
| `card-issuing` | `cards.getvouch.club` | Stripe Issuing virtual cards |
| `calling-agent` | `callingagent.getvouch.club` | Outbound voice calls (Vapi) |
| `dashboard` | `dashboard.getvouch.club` | The product surface |
| `claude/vigilant-meitner-fxqi9c` | — | Production branch / base for all of the above |

**Onboarding flow:** `login` → `gmail` → `bank` *(skippable)* → `voice` →
`dashboard`.

Identity verification is deliberately **not** in that chain — see §6.

---

## 2. Tech stack

**Application layer** — every branch is the same shape:

- **Next.js 15.5** (App Router), **React 19**, **TypeScript 5.7** (strict)
- **Vercel** — one project, Git Branch Domains give each branch its own
  subdomain; every branch except production deploys to the *Preview*
  environment
- **`pg`** for Postgres, via a lazy proxy pool (`lib/db.ts`) so importing it
  never crashes a build when `DATABASE_URL` isn't set yet
- **`jose`** (HS256 JWT) for session verification; the portal signs with
  `jsonwebtoken` + `bcryptjs` — interoperable, same RFC 7519 format
- **Tailwind 4** on most branches; the dashboard uses hand-written CSS
  inherited from the original hackathon UI
- **Vitest** for unit tests on the branches that have logic worth testing

**Data:**

- **Postgres 18** on **GCP Cloud SQL** (instance `vouch-db`, `us-central1`),
  with **pgvector** for embeddings

**Third-party services:**

| Service | Used for | Branch |
|---|---|---|
| **Google Gmail API** | reading receipt/renewal email | `gmail-connector` |
| **Backboard.io** | per-user persistent memory, semantic search | `gmail-connector`, `dashboard`, `calling-agent` |
| **Plaid** | bank account linking + balances | `bank-connection` |
| **Stripe Issuing** | virtual card creation and authorization | `card-issuing`, `dashboard` |
| **Vapi** | call orchestration + telephony | `calling-agent` |
| **ElevenLabs** | the agent's voice (TTS) | `calling-agent` |
| **Google Gemini** (`gemini-2.5-flash`) | the agent's reasoning on calls | `calling-agent` |
| **Persona** | government ID, selfie liveness, phone verification | `identity-verification` |
| **GCP Cloud Run** | hosts our own ML service (below) | `voice-verification` |

**Our own ML service** — `services/voice-inference`, the one part of the
stack that isn't someone else's API:

- **Python + FastAPI** on Cloud Run, containerised
- **ECAPA-TDNN** speaker embeddings → `/embed`, `/verify` (cosine similarity
  against an enrolled voiceprint, threshold 0.5)
- **AASIST** anti-spoofing → `/spoof-check` (advisory only — see §7)
- Auth: Cloud Run IAM via a Google-signed ID token, **plus** an app-level
  API key as defence in depth

---

## 3. Authentication: one cookie, eight services

The `portal` branch is the only thing that issues a session. It sets
`vouch_session` — an HS256 JWT — on domain `.getvouch.club`, so every
subdomain sees it. Every other branch verifies it with the shared
`JWT_SECRET` and never issues one; signed-out visitors get redirected back
to the portal.

Each branch's `middleware.ts` gates its own routes on the Edge runtime,
which is why session logic lives in `lib/session-token.ts` with **no
database import** — Edge can't load `pg`.

This is also how services call each other. When the dashboard's "Call me"
button fires, the *server* forwards the user's session cookie to the
calling-agent branch. Both verify the same secret, so `requireUser()`
resolves the same person with no separate service-to-service auth and no
CORS.

---

## 4. The data pipeline

**Gmail → classification → memory**, per message (`lib/gmail-sync.ts`):

```
extract body → chunk → embed → store (gmail_messages, gmail_message_chunks)
     → classify (pgvector similarity vs. spending_categories)
     → ┌ write to local memory tables
       └ write to Backboard          ← these two run concurrently
```

Classification must finish first (both writes consume its category), but the
two memory writes are independent and run in parallel.

**Subscriptions are derived, not declared.** `lib/dashboard-data.ts` groups
classified `subscription_signup_renewal` emails by merchant to get price,
cadence, and price changes, then joins that against real issued cards.

**Decisions are rule-based, not generated.** `analyzeReal()` produces
renew / hold / ask / cancel from observable facts — price change, charge
count, days to renewal, whether a card is live. No LLM decides whether to
spend your money.

That is a deliberate line: `/dashboard` shows only real data, and
`/demo` shows the original hackathon mock data. The two never mix.

---

## 5. The voice loop

Vouch's distinguishing feature is that the agent **calls you** to confirm a
charge.

1. Dashboard "Call me" → proxies to `calling-agent`
2. `calling-agent` pulls the user's **top-k Backboard memories** for that
   merchant and folds them into the call's system prompt
3. Vapi places the call; **Gemini** reasons, **ElevenLabs** speaks
4. The conversation follows a fixed shape: time-of-day greeting → "how are
   you doing?" → answer in kind if asked back → this month's payments →
   relevant history from memory → a gentle ask about the renewal
5. On hang-up, Vapi posts a webhook with transcript + recording
6. `detectHuman()` runs the recording against the user's enrolled voiceprint
   via the Cloud Run `/verify` endpoint

The extracted result is a typed JSON object (`{confirmed, concern_reason}`),
produced by Vapi's structured-data plan from the transcript.

**Verified working end to end** — a real call was placed, held a natural
conversation, and returned `{"confirmed": true}`.

---

## 6. Identity: why it isn't an onboarding step

Before `identity-verification`, everything the spending decision rested on
was **self-attested**:

- The cardholder name sent to Stripe Issuing came from a signup form field.
- The phone number the agent calls to authorize charges came from a form
  field too — so anyone who got into an account could change it and then
  approve every charge by answering their own phone. Enrolling their own
  voice defeats the speaker-match as well, since that only proves the caller
  is whoever enrolled, not who that is.

Persona closes both. But it is **not** a fifth onboarding step — it triggers
at **first card mint**, the moment the agent is about to spend, where the
reason for asking is concrete. Anyone who just wants to look around reaches
the dashboard exactly as fast as before.

```
unverified  → agent may OBSERVE : read Gmail, surface subscriptions
verified    → agent may ACT     : mint cards, place calls
```

**The voice binding is the point.** `voice_enrollments` alone proves
*consistency* — the voice on a call matches the voice that enrolled. On
approval, the Persona inquiry id is written onto that enrollment row, so
every later speaker-match inherits a government-ID check. One verification,
billed once, upgrades unlimited future phone confirmations into identity
proof. Two biometrics — Persona's face, our voice — anchored to one verified
identity, used at different moments.

**Data minimization is enforced in the schema.** We store what Stripe needs
for a cardholder (name, address) plus derived booleans — notably
`is_over_18` instead of the date of birth, because the age check is the only
thing the DOB is for. No document numbers, no birthdates, no ID images.
Persona stays the system of record.

---

## 7. Things that are honest about their limits

Kept here because pretending otherwise is how systems rot.

- **Anti-spoofing is advisory.** AASIST was trained on clean studio audio;
  browser-mic audio (webm/opus, echo cancellation) is a channel mismatch
  producing false positives. Logged for calibration, never blocking.
- **Speaker-matching on calls is post-call, not live.** It needs the full
  recording. Vapi *does* expose a live audio stream (`monitor.listenUrl`,
  PCM over WebSocket) and mid-call speech injection (`controlUrl`), so
  real-time identity gating is buildable — but it needs an always-on
  listener process, which Vercel's request-scoped functions can't host. It
  would live next to the Cloud Run inference service.
- **Stripe Issuing is provisioning.** The sandbox Financial Account is stuck
  `status: pending`, and Stripe's API refuses card creation until it opens.
  Not a code problem — `financial_account_v2` is already passed correctly,
  so minting works the moment it flips.
- **The dashboard shows no usage data**, because nothing in this codebase
  measures app usage. The demo's usage numbers are mock data and stay in the
  demo.
- **Backboard has two undocumented bugs** we work around: a hard 4096-byte
  content limit, and a 500 on any non-integer float in metadata (floats are
  stored as strings).

---

## 8. Database

One Postgres instance, shared. Each branch owns its tables and extends the
schema rather than forking the connection.

| Owner | Tables |
|---|---|
| `portal` | `users`, `user_profiles` |
| `gmail-connector` | `gmail_connections`, `gmail_messages`, `gmail_message_chunks`, `gmail_message_classifications`, `spending_categories`, `memories`, `memory_chunks`, `memory_relations`, `memory_versions`, `backboard_assistants` |
| `bank-connection` | `plaid_items`, `plaid_accounts` |
| `card-issuing` | `stripe_cardholders`, `issued_cards`, `card_transactions` |
| `voice-verification` | `voice_enrollments`, `voice_verifications` |
| `calling-agent` | `calling_agent_calls`, `calling_agent_events` |
| `identity-verification` | `identity_verifications`, `identity_verification_events` |

Sensitive values are encrypted at rest with AES-256-GCM (`lib/crypto.ts`):
voice embeddings (biometric data) and Plaid access tokens.

Migrations are plain SQL under `db/migrations/`, applied via
`npm run db:migrate`.

---

## 9. Operational notes

- **Vercel env vars are per-environment and not inherited.** Only the
  production branch deploys to *Production*; every service branch deploys to
  *Preview*, so secrets must be added to Preview explicitly.
- **Secrets added via `vercel env add` are write-only.** They can never be
  read back — not by anyone, including whoever set them. Plan for that:
  database migrations run through GCP, not a locally pulled `DATABASE_URL`.
- **`NEXT_PUBLIC_*` vars are inlined at build time**, so changing one
  requires a redeploy of that branch, not just a settings change.
- Preview deployments sit behind Vercel's SSO Deployment Protection, which
  blocks third-party webhooks unless explicitly bypassed — decide per
  service.

---

## 10. Per-service documentation

| Doc | Branch |
|---|---|
| `docs/GMAIL.md` | `gmail-connector` |
| `docs/PLAID.md` | `bank-connection` |
| `docs/CARDS.md` | `card-issuing` |
| `docs/VOICE.md` | `voice-verification` |
| `docs/CALLING_AGENT.md` | `calling-agent` |
| `docs/DASHBOARD.md` | `dashboard` |
| `docs/IDENTITY.md` | `identity-verification` |
| `CLAUDE.md` | this branch — the branch/subdomain convention |
