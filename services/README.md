# Every service, in one place

Vouch runs as eight independently deployed Next.js apps, each living on its own
long-lived git branch and its own subdomain. That's great for deployment and
bad for reading, since you'd have to check out eight branches to see the whole
system.

So each folder here is a **snapshot of one branch's full source**, copied in so
the entire codebase can be read from a single branch. This branch is never
deployed (see `vercel.json`); the branches are the source of truth and the only
thing that ships.

| Folder | Branch | Subdomain | What it owns |
|---|---|---|---|
| `portal/` | `portal` | `login` | signup/login, issues the `vouch_session` JWT |
| `gmail-connector/` | `gmail-connector` | `gmail` | Gmail sync, embeddings, classification, memory |
| `bank-connection/` | `bank-connection` | `bankconnection` | Plaid link, accounts, balances |
| `card-issuing/` | `card-issuing` | `cards` | Stripe Issuing, webhooks, **the MCP server** |
| `voice-verification/` | `voice-verification` | `voice` | voice enrollment, speaker matching |
| `identity-anchor/` | `identity-anchor` | `identity` | Persona ID + selfie, the voice binding |
| `calling-agent/` | `calling-agent` | `callingagent` | outbound voice calls |
| `dashboard/` | `dashboard` | `dashboard` | the real dashboard and `/demo` |

`package-lock.json` is stripped from each snapshot; it's several hundred KB of
noise in a branch meant for reading. Everything else is verbatim.

## Where to look first

Short on time? These are the files that carry the ideas rather than the wiring.

- **`card-issuing/lib/mcp/server.ts`** — the eight MCP tools an agent gets.
  Every one is scoped to a single user through closures, and none returns a
  card number for a Stripe-issued card.
- **`card-issuing/lib/stripe.ts`** — issuance and the single-use rule. The
  auto-cancel lives in `recordCardTransaction`, fired by the webhook.
- **`identity-anchor/lib/persona-schema.ts`** — why `approved` is the only
  status that counts, and the age check that keeps the boolean and discards the
  birthdate.
- **`calling-agent/lib/calling-agent/assistant.ts`** — the whole phone
  conversation, written as a prompt: time-of-day greeting, small talk, this
  month's spend, Backboard history, then the renewal ask.
- **`voice-verification/app/api/voice/enroll/route.ts`** — three clips averaged
  into one centroid embedding, encrypted at rest.
- **`dashboard/lib/dashboard-data.ts`** — every number on the real dashboard and
  exactly which table it comes from.
- **`gmail-connector/lib/gmail-sync.ts`** — extract, chunk, embed, classify,
  then two memory writes running concurrently.

## Reading notes

Each service carries its own copy of `lib/db.ts`, `lib/session.ts` and
`lib/crypto.ts` rather than importing across branches. They share a database
and a session cookie, not a codebase. The duplication is the point: a branch can
be deployed, broken or rewritten without reaching into another one.

Every service has a `docs/` folder covering its setup, data model, and the
reasoning behind anything non-obvious, and a `.env.example` that documents each
variable and where to get it.
