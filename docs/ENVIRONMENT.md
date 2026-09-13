# Environment variables — Vouch

Every branch is a separate Vercel deployment (Preview, except production)
with its own environment variable set — **nothing is inherited across
branches or across environments** (see `docs/DEPLOYMENT.md` §3). This is
the full catalog, pulled from every branch's `.env.example` plus a
`process.env.` grep, organized so you can answer two questions: *what does
this branch need*, and *which values must be byte-identical across
branches because another branch has to decrypt or verify something this
one wrote*.

---

## 1. Values shared across branches (must match exactly)

These aren't "the same kind of value coincidentally" — they are **the same
literal secret**, copy-pasted into multiple branches' Vercel Preview env
config. Rotating one without rotating every branch that shares it breaks
that branch silently (sessions stop verifying, ciphertext stops
decrypting) with no error that points at the actual cause.

| Variable | Shared by | Why it must match |
|---|---|---|
| `JWT_SECRET` | **All 8 branches** | `portal` is the only branch that *signs* the `vouch_session` JWT (HS256). Every other branch only *verifies* it. A mismatched secret doesn't error — it just makes every visitor look signed-out. |
| `SESSION_COOKIE_DOMAIN` | All 8 branches | Set to `.getvouch.club` everywhere so the cookie `portal` sets is readable on every subdomain. Not a secret, but must be consistent or cross-subdomain sessions silently stop working. |
| `ENCRYPTION_KEY` | `bank-connection`, `gmail-connector`, `voice-verification`, `calling-agent`, `card-issuing` | AES-256-GCM key for the shared (copied) `lib/crypto.ts`. `bank-connection` encrypts Plaid tokens, `gmail-connector` encrypts Gmail OAuth tokens, `voice-verification` encrypts voice embeddings — each with this key. `calling-agent` needs the *same* key only to **decrypt** `voice_enrollments.embedding` for `detectHuman()`. `card-issuing` carries the file (and the env var) but, per its own `.env.example` comment, doesn't currently encrypt anything with it — kept only for consistency with the shared `lib/crypto.ts` copy. |
| `STRIPE_SECRET_KEY`, `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID` | `card-issuing`, `dashboard` | Same Stripe test-mode account. `dashboard` needs both only for its "Mint card & renew" action. |
| `BACKBOARD_API_KEY` | `gmail-connector` (read+write), `dashboard` (read-only), presumably `calling-agent` (reads memories for call context — confirm in `docs/services/calling-agent.md`) | Same Backboard.io account/key. `gmail-connector` writes; `dashboard` only searches, to show raw memories in the decision popup. Unset on `dashboard` just means no memories are shown — not a hard failure. |
| `VOICE_SERVICE_URL`, `VOICE_SERVICE_API_KEY`, `GCP_VOICE_CALLER_KEY_BASE64` | `voice-verification`, `calling-agent` | Point at the same Cloud Run `voice-inference` deployment. `calling-agent` needs all three (plus `ENCRYPTION_KEY` above) to run its own speaker-match via `detectHuman()`, independent of the `voice-verification` branch's own UI. |

---

## 2. Per-branch onboarding-chain URLs

Every branch knows the URL of *its own next step* (never a full map of the
chain) via plain env vars — this is how the linear onboarding flow (`login
→ gmail → bank → voice → dashboard`) is actually wired together across
independently-deployed subdomains, with no shared routing table anywhere.

| Branch | Var | Points to |
|---|---|---|
| `gmail-connector` | `BANK_CONNECTION_URL` | `https://bankconnection.getvouch.club/bank` |
| `bank-connection` | `NEXT_PUBLIC_VOICE_REGISTER_URL` | `https://voice.getvouch.club/voice/register` |
| `voice-verification` | `NEXT_PUBLIC_DASHBOARD_URL` | `https://dashboard.getvouch.club` (onboarding's terminal step) |
| `identity-verification` | `NEXT_PUBLIC_DASHBOARD_URL` | `https://dashboard.getvouch.club` (return-to point after verification, not part of the linear chain — see `ARCHITECTURE.md` §6) |
| `dashboard` | `CALLING_AGENT_URL` | `https://callingagent.getvouch.club` — not onboarding, this is the "Call me" server-to-server proxy target |

Every branch except `portal` also carries `PORTAL_LOGIN_URL` /
`NEXT_PUBLIC_PORTAL_LOGIN_URL` (both usually `https://login.getvouch.club/login`)
— where a signed-out visitor gets redirected, since no branch but `portal`
has a login page of its own. `gmail-connector`'s `.env.example` is missing
the `NEXT_PUBLIC_` variant that every sibling branch has (server-side var
present, client-side one absent) — confirm in `docs/services/gmail-connector.md`
whether that's intentional (a server-only redirect) or a gap.

---

## 3. Full variable catalog by branch

### `portal` (login.getvouch.club) — the minimal set

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres connection string |
| `JWT_SECRET` | **Signs** session JWTs (every other branch only verifies) |
| `SESSION_COOKIE_DOMAIN` | `.getvouch.club` |

Notably absent from `portal`'s own `.env.example`: `PORTAL_LOGIN_URL` (it
doesn't need to redirect to itself) and `ENCRYPTION_KEY` (it stores
password hashes via `bcryptjs`, not `lib/crypto.ts`-encrypted secrets).

### `bank-connection` (bankconnection.getvouch.club)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres |
| `PLAID_CLIENT_ID`, `PLAID_SECRET` | Plaid API credentials |
| `PLAID_ENV` | `sandbox` |
| `PLAID_WEBHOOK_URL` | Where Plaid POSTs sync/item events |
| `PLAID_REDIRECT_URI` | Must exactly match a URI registered in Plaid's dashboard; only needed for OAuth institutions |
| `ENCRYPTION_KEY` | Encrypts Plaid access tokens (shared value, §1) |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN` | Session verification (shared value, §1) |
| `PORTAL_LOGIN_URL`, `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Signed-out redirect |
| `NEXT_PUBLIC_VOICE_REGISTER_URL` | Next onboarding step |

### `gmail-connector` (gmail.getvouch.club)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres (this branch's `.env.example` shows the GCP Cloud SQL form — see `docs/DATABASE.md` §6) |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`, `PORTAL_LOGIN_URL` | Session verification / redirect |
| `BANK_CONNECTION_URL` | Next onboarding step |
| `ENCRYPTION_KEY` | Encrypts Gmail OAuth tokens (shared value, §1) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud OAuth 2.0 Web client |
| `NEXT_PUBLIC_APP_URL` | This deployment's own base URL — builds the OAuth redirect URI |
| `GOOGLE_REDIRECT_URI` | Optional override of the computed redirect URI |
| `GOOGLE_CLOUD_PROJECT` | `patchguard-reakon` (real value, not a placeholder, in the example file) |
| `GOOGLE_CLOUD_LOCATION` | `us-central1` |
| `CRON_SECRET` | Bearer secret the Vercel Cron caller must send to `POST /api/cron/gmail-sync`; fails closed if unset |
| `BACKBOARD_API_KEY` | Backboard.io key (shared value, §1) — optional, sync degrades gracefully without it |

`GOOGLE_CLOUD_PROJECT`/`GOOGLE_CLOUD_LOCATION` back Vertex AI
`text-embedding-004`, authenticated via Application Default Credentials
(`GoogleAuth({scopes: ["cloud-platform"]})`) rather than an API key — same
auth pattern the `voice-inference` Cloud Run caller uses. No separate key
file needed when running on GCP infra with the right service account
attached; this implies the Vercel deployment itself needs a way to present
GCP ADC, which is unusual for a Vercel-hosted app — worth confirming in
`docs/services/gmail-connector.md` how ADC is actually supplied outside GCP
infra (a service-account JSON env var, most likely).

### `card-issuing` (cards.getvouch.club)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres (GCP Cloud SQL form) |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`, `PORTAL_LOGIN_URL`, `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Session verification / redirect |
| `ENCRYPTION_KEY` | Carried for consistency; not currently used to encrypt anything this branch stores (§1) |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe test-mode API keys |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /api/stripe/webhook` requests actually came from Stripe |
| `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID` | Required on every card-creation call by this account's Issuing setup (`fa_test_...`) |

### `dashboard` (dashboard.getvouch.club)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`, `PORTAL_LOGIN_URL`, `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Session verification / redirect |
| `STRIPE_SECRET_KEY`, `STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID` | Same Stripe account as `card-issuing`, for "Mint card & renew" |
| `BACKBOARD_API_KEY` | Read-only here; shows raw memories per subscription. Optional. |
| `CALLING_AGENT_URL` | Proxy target for "Call me" — this branch never talks to Vapi directly |

### `voice-verification` (voice.getvouch.club) + `services/voice-inference` (Cloud Run)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres (Tiger Cloud form) |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`, `PORTAL_LOGIN_URL`, `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Session verification / redirect |
| `NEXT_PUBLIC_DASHBOARD_URL` | Onboarding's terminal redirect, once enrollment succeeds |
| `ENCRYPTION_KEY` | Encrypts voice embeddings at rest (shared value, §1) |
| `VOICE_SERVICE_URL` | Base URL of the separately-deployed Cloud Run `voice-inference` service |
| `VOICE_SERVICE_API_KEY` | App-level shared secret, defence in depth on top of Cloud Run IAM |
| `GCP_VOICE_CALLER_KEY_BASE64` | base64 of a service account JSON key, used to mint the Google-signed ID token Cloud Run's IAM invoker check requires (the service is deployed **without** `--allow-unauthenticated`) |

The Cloud Run service itself (`services/voice-inference`) reads its own
environment (via Python `os.environ`/pydantic settings, not Next.js
`process.env`) — confirm its exact var names in
`docs/services/voice-verification.md`; expect at minimum the matching
`VOICE_SERVICE_API_KEY` and whatever threshold constants (speaker-match
0.5, per root `ARCHITECTURE.md`) are or aren't exposed as config rather
than hardcoded.

### `identity-verification` (identity.getvouch.club)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`, `PORTAL_LOGIN_URL`, `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Session verification / redirect |
| `NEXT_PUBLIC_DASHBOARD_URL` | Where to return the user after verification |
| `PERSONA_API_KEY` | Server-side Persona API key — sandbox keys start `persona_sandbox_`, production `persona_production_`; the example file warns never to put a production key here |
| `PERSONA_TEMPLATE_ID` | The inquiry template the flow runs — chosen **server-side only**, never by the browser, specifically so a user can't point the widget at a weaker template than intended |
| `NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID` | Sandbox vs. production, read by the embedded widget |
| `PERSONA_WEBHOOK_SECRET` | Without it, the webhook route fails closed (500) rather than trusting an unsigned event — an accepted unsigned webhook would let anyone who finds the URL mark themselves verified, and verified is what lets the agent spend money |

### `calling-agent` (callingagent.getvouch.club)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Shared Postgres |
| `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`, `PORTAL_LOGIN_URL`, `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Session verification / redirect |
| `VAPI_API_KEY` | From the Vapi dashboard |
| `VAPI_ASSISTANT_ID` | Set after running `npm run calling-agent:sync-assistant` once (the script prints the id) |
| `VAPI_PHONE_NUMBER_ID` | The Vapi phone number to call from |
| `CALLING_AGENT_WEBHOOK_URL` | This deployment's real webhook URL, registered with Vapi |
| `CALLING_AGENT_WEBHOOK_SECRET` | Checked against the `x-calling-agent-secret` header Vapi echoes back |
| `ELEVENLABS_VOICE_ID` | Used via Vapi's built-in 11labs voice provider (register the ElevenLabs key as a Vapi Provider Key, not here) |
| `CALLING_AGENT_MODEL_PROVIDER`, `CALLING_AGENT_MODEL` | Default `google` / `gemini-2.5-flash`; swappable to any Vapi-supported provider |
| `ENCRYPTION_KEY`, `VOICE_SERVICE_URL`, `VOICE_SERVICE_API_KEY`, `GCP_VOICE_CALLER_KEY_BASE64` | Speaker-match human detection — same Cloud Run service and shared secrets as `voice-verification` (§1) |

---

## 4. Operational notes (from the root `CLAUDE.md`)

- **Not inherited across environments.** A new service branch deploys to
  Vercel's *Preview* environment; only the branch in `productionBranch`
  deploys to *Production*. `DATABASE_URL` and every service-specific secret
  must be added to Preview explicitly (`vercel env add <NAME> preview`) —
  nothing carries over from Production automatically.
- **Write-only once set.** Secrets added via `vercel env add` can never be
  read back through the Vercel CLI/dashboard by anyone, including whoever
  set them. This is *why* `docs/DATABASE.md` §6 can't just check which
  `DATABASE_URL` is live — there's no read path, only re-setting.
  Operational processes (like running a migration by hand) have to pull
  connection details from wherever they were originally provisioned (GCP
  Cloud SQL / Tiger Cloud console), not from a locally `vercel env pull`'d
  value if that value has since been rotated without a corresponding local
  refresh.
- **`NEXT_PUBLIC_*` vars are inlined at build time.** Changing one requires
  a redeploy of that specific branch — a Vercel settings change alone does
  nothing until the next build.
- **Preview Deployment Protection.** Every non-production branch (i.e.
  every service branch) sits behind Vercel's SSO-based Deployment
  Protection by default. Fine for a human browsing in — blocks third-party
  webhook callers (Plaid, Stripe, Persona, Vapi) unless explicitly
  bypassed for that deployment. This is a per-service, security-relevant
  decision, not a default to flip silently — and per the
  `bank-connection` findings in `docs/services/bank-connection.md`,
  whether this was actually resolved for the Plaid webhook specifically is
  **unconfirmed** from the repo alone. Check the same question for every
  other branch with an inbound webhook (`card-issuing`'s Stripe webhook,
  `identity-verification`'s Persona webhook, `calling-agent`'s Vapi
  webhook, `gmail-connector`'s Vercel Cron caller) rather than assuming
  it was handled once and applies everywhere.

---

## 5. Related docs

- [`docs/DATABASE.md`](./DATABASE.md) §6 — the `DATABASE_URL` discrepancy
  across branches in full.
- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — how these variables map to
  actual Vercel project/environment configuration.
- `docs/services/*.md` — how each branch actually consumes its variables
  in code.
