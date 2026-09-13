# Deployment — Vercel, subdomains, and the two GCP pieces

Vouch is one Vercel project fronting nine git branches (production + eight
service branches), plus two pieces of infrastructure Vercel doesn't host at
all: the shared Postgres database and the `voice-inference` ML service on
GCP Cloud Run. This doc is the operational reference for all of it.

---

## 1. The Vercel project

- Project: `acme-1b76/vouch`, connected to the `kbhatnagar1506/vouch` GitHub
  repo via the standard GitHub → Vercel integration (push-to-deploy, no
  separate CI config in this repo — Vercel's own build pipeline is the only
  build step).
- **Production branch**: `claude/vigilant-meitner-fxqi9c`. Every push to it
  auto-deploys to the project's Production environment and its production
  domain(s).
- **Every other branch that has a push at all** auto-deploys to a Preview
  deployment — this includes all eight service branches, which are
  long-lived (not short-lived feature branches Vercel would otherwise treat
  as disposable).
- No second Vercel project exists or is needed for any service branch —
  the fan-out to per-service subdomains happens entirely through Vercel's
  **Git Branch Domains** feature (below), inside this one project.

---

## 2. Branch → subdomain map

| Branch | Subdomain | Vercel environment | Role |
|---|---|---|---|
| `claude/vigilant-meitner-fxqi9c` | *(production domain(s), not a `getvouch.club` subdomain listed in-repo)* | Production | Base branch every service branch forks from; currently just the minimal scaffold (health check + `lib/db.ts`) plus root docs |
| `portal` | `login.getvouch.club` | Preview | Sign-up / login — the only issuer of sessions |
| `gmail-connector` | `gmail.getvouch.club` | Preview | Gmail OAuth, sync, classification, memory |
| `bank-connection` | `bankconnection.getvouch.club` | Preview | Plaid bank linking (skippable) |
| `voice-verification` | `voice.getvouch.club` | Preview | Voice enrollment + speaker verification |
| `identity-verification` | `identity.getvouch.club` | Preview | Persona ID + selfie liveness (not yet wired into any trigger — see `docs/services/identity-verification.md`) |
| `card-issuing` | `cards.getvouch.club` | Preview | Stripe Issuing virtual cards + MCP server |
| `calling-agent` | `callingagent.getvouch.club` | Preview | Outbound voice calls (Vapi) |
| `dashboard` | `dashboard.getvouch.club` | Preview | The product surface |

Onboarding order: **`login` → `gmail` → `bank` (skippable) → `voice` →
`dashboard`**, wired together by plain env vars pointing each branch at the
next one's URL (`docs/ENVIRONMENT.md` §2) — there is no central router or
shared config; each branch only knows its own next hop.
`identity-verification` is deliberately outside that chain (see root
`ARCHITECTURE.md` §6) and is not currently invoked from anywhere in the
other branches' code (`docs/services/identity-verification.md` confirms
zero references to it from `card-issuing`, the branch it's meant to gate).

---

## 3. Binding a subdomain to a branch

Mechanism: Vercel Project Settings → Domains → attach a domain to a
specific branch (equivalently, `PATCH /v9/projects/:id/domains/:domain`
with `{"gitBranch": "<branch>"}`). Once bound, every push to that branch
auto-deploys to that subdomain through the existing GitHub → Vercel
connection — no new Vercel project, no new integration.

**Caveat found while compiling this doc:** the root `CLAUDE.md` states this
process is worked through concretely in `docs/PLAID.md` ("see `docs/PLAID.md`
for the worked example with `bankconnection.getvouch.club`"). It isn't —
`docs/services/bank-connection.md` (this pass's deep-dive on that branch)
confirms `docs/PLAID.md` contains only generic UI/CNAME steps, no actual
`PATCH` example, across the branch's full history. The promise was added to
`CLAUDE.md` in commit `24d36dd`, 44 minutes *after* `bank-connection` had
already forked from production at `7400233` — it was written as if it
belonged in a doc that, on that branch, didn't yet exist and was never
backfilled after the fact. **Treat `CLAUDE.md`'s pointer to that worked
example as stale** until someone actually adds it to `docs/PLAID.md`, or
routes the domain-binding walkthrough through this file instead.

---

## 4. Env vars are per-environment, never inherited

A new service branch deploys to **Preview**, not Production — only the
branch named in the project's `productionBranch` setting gets Production.
Vercel does not copy Production env vars into Preview, or one Preview
deployment's vars into another. Concretely:

- `DATABASE_URL` (needed by literally every branch) must be added to
  Preview explicitly, separately from however it's set on Production.
- Every service-specific secret (`PLAID_*`, `STRIPE_*`, `VAPI_*`,
  `PERSONA_*`, …) is scoped to its own branch's Preview config — there is
  no "add once, every service sees it" step.
- Add via `vercel env add <NAME> preview` (CLI) or the dashboard's
  per-branch environment variable UI. See `docs/ENVIRONMENT.md` for the
  full catalog of what each branch actually needs.
- **Secrets are write-only once set** — `vercel env add` cannot be read
  back by anyone afterward, including whoever set it. There is no `vercel
  env get` for a secret's value. This matters operationally: you cannot
  audit "what is `DATABASE_URL` currently set to on branch X" from the
  Vercel side at all; you can only overwrite it and trust the new value
  (see `docs/DATABASE.md` §6, where this is exactly the wall hit trying to
  confirm which database is actually live).
- **`NEXT_PUBLIC_*` vars are inlined at build time**, not read at request
  time. Changing one in the dashboard does nothing to an already-built
  deployment — it takes a fresh build of that branch (a new push, or a
  manual redeploy) to take effect. `docs/services/voice-verification.md`
  documents a concrete case of this biting in production: the
  onboarding-complete redirect to `dashboard.getvouch.club` "existed but
  never fired" for a period because `NEXT_PUBLIC_DASHBOARD_URL` was set in
  Vercel *after* the branch's last build — the fix that mattered was
  forcing a rebuild, not the code change itself.

---

## 5. Deployment Protection and third-party webhooks

Every Preview deployment — which, on this project, means every service
branch, permanently, not just during initial review — sits behind Vercel's
SSO-based Deployment Protection by default. A signed-in team member can
browse any of it fine. A third-party server cannot: Plaid's webhook caller,
Stripe's webhook caller, Persona's webhook caller, Vapi's webhook caller,
and Vercel's own Cron invoker calling `gmail-connector`'s
`/api/cron/gmail-sync` are all, by default, external requests that
Deployment Protection will intercept before they ever reach the app's own
route handler and signature-verification logic.

This has to be bypassed **per deployment** for any branch with an inbound
webhook — it's explicitly called out in the root `CLAUDE.md` as "a
security-relevant setting, not a default to flip silently," i.e. a
deliberate per-service decision, not a blanket toggle.

Branches with an inbound webhook/cron caller that this applies to:

| Branch | Inbound caller | Route |
|---|---|---|
| `bank-connection` | Plaid | `POST /api/plaid/webhook` |
| `card-issuing` | Stripe | `POST /api/stripe/webhook` |
| `identity-verification` | Persona | `POST /api/identity/webhook` |
| `calling-agent` | Vapi | `POST /api/calling-agent/webhook` |
| `gmail-connector` | Vercel Cron (internal, but still an HTTP caller external to a browser session) | `POST /api/cron/gmail-sync` |

**Confirmed unresolved for at least one of these** —
`docs/services/bank-connection.md` found that while the Plaid webhook's own
signature verification is solid (ES256 JWT, body hash, 5-minute freshness
window), nothing in that branch's docs or code states whether Deployment
Protection was actually bypassed for its Preview deployment. If it wasn't,
Plaid's webhook calls are being silently blocked at the Vercel edge before
they ever reach that verification logic — which would look, from the
outside, like "webhooks just don't arrive," not like an auth failure.
**Don't assume this was solved once and carries to the other four rows in
the table above** — check each deployment's Deployment Protection setting
individually against whether its corresponding third-party webhook is
actually observed arriving.

---

## 6. Database infrastructure

The application layer (every branch) connects to one shared Postgres
instance via `DATABASE_URL` and a lazily-constructed `pg.Pool`
(`lib/db.ts` — wrapped in a `Proxy` specifically so importing the module
never crashes a build before env vars are configured, e.g. on a brand-new
Preview deployment). See `docs/DATABASE.md` for the full schema.

**Which instance is actually live is not fully resolved from the repo
alone** — `docs/DATABASE.md` §6 has the full account, but in short:

- The root `CLAUDE.md` documents installing and building **Tiger CLI**
  (TigerData's CLI for Tiger Cloud / TimescaleDB), and Tiger Cloud's
  connection-string shape (`tsdbadmin@*.tsdb.cloud.timescale.com:30488/tsdb`)
  is what five of nine branches' `.env.example` files show — including
  production itself.
- The root `ARCHITECTURE.md` (written later) instead states the database
  is **Postgres 18 on GCP Cloud SQL** (instance `vouch-db`, `us-central1`,
  with `pgvector`) — and the two branches with the most live-database
  testing history (`card-issuing`, `gmail-connector`) show a Cloud SQL
  connection-string shape in their own `.env.example`.
- Since Vercel secrets are write-only (§4), there's no way to settle this
  by reading configuration back. Treat `ARCHITECTURE.md`'s Cloud SQL claim
  as the operative one, but verify directly against each branch's live
  Vercel project settings before it matters operationally (e.g. before
  running a migration by hand against "the" database).

**Tiger CLI**, regardless of which instance ends up being canonical, is
still useful — it bundles an MCP server for coding agents and is this
repo's documented path for Postgres/TimescaleDB CLI access. Install
instructions (including a from-source fallback for network-restricted
environments where `cli.tigerdata.com` and `packagecloud.io` are blocked
at the egress proxy but `github.com` and `proxy.golang.org` are reachable)
are in the root `CLAUDE.md` — not duplicated here.

Every branch's own `db/migrations/` (or `portal`'s `migrations/`) is
applied via `npm run db:migrate` → `scripts/migrate.mjs`, which is
effectively identical across all eight service branches (byte-for-byte on
seven of them; `portal`'s only differs in which directory it reads from).
See `docs/DATABASE.md` §1 for exactly how it tracks applied migrations
across branches sharing one `_migrations` table.

---

## 7. `voice-inference` on GCP Cloud Run

The one piece of this stack that isn't a Vercel-hosted Next.js branch or
someone else's SaaS API: `services/voice-inference` (Python + FastAPI,
containerised), living inside the `voice-verification` branch but deployed
independently to **GCP Cloud Run**.

- ECAPA-TDNN speaker embeddings (`/embed`, `/verify` — cosine similarity
  against an enrolled voiceprint) and AASIST anti-spoofing (`/spoof-check`,
  advisory-only — see root `ARCHITECTURE.md` §7).
- Model weights are **baked into the image at build time** (both
  ECAPA-TDNN, via a build-time download step whose cache-dir `ENV` persists
  into the runtime container so nothing re-downloads on cold start, and
  AASIST, committed straight into the repo as a binary checkpoint file) —
  this is what eliminated the service's original cold-start latency
  problem.
- Deployed **without** `--allow-unauthenticated`: callers (`voice-verification`
  and `calling-agent`, the only two branches that talk to it) authenticate
  with a Google-signed ID token minted from a service-account key
  (`GCP_VOICE_CALLER_KEY_BASE64`), **plus** an app-level
  `VOICE_SERVICE_API_KEY` as defence in depth on top of Cloud Run IAM.
- Both consuming branches (`voice-verification`, `calling-agent`) need the
  same three values (`VOICE_SERVICE_URL`, `VOICE_SERVICE_API_KEY`,
  `GCP_VOICE_CALLER_KEY_BASE64`) plus the same `ENCRYPTION_KEY` — see
  `docs/ENVIRONMENT.md` §1.
- Threshold constants (speaker-match cosine similarity, currently `0.5`)
  are wired as configurable env vars in the service's own code but, per
  `docs/services/voice-verification.md`, the documented deploy command
  never actually sets them — production runs on the hardcoded defaults,
  not a deliberately-tuned value, despite the config path existing.

This service has its own deploy lifecycle (`gcloud run deploy`, not a
Vercel push) — see `docs/services/voice-verification.md` for the full
Dockerfile/build/deploy walkthrough.

---

## 8. Service lifecycle: from branch to production

Per the root `CLAUDE.md`: when a service is ready for real users, **merge
its branch into `claude/vigilant-meitner-fxqi9c`** (or promote it
directly) rather than rebuilding it on the production branch. As of this
doc, production (`claude/vigilant-meitner-fxqi9c`) is still just the
original minimal scaffold — none of the eight service branches have been
merged in yet. Each stays independently deployed on its own subdomain
until that happens.

---

## 9. Related docs

- [`docs/DATABASE.md`](./DATABASE.md) — full shared schema, migration
  mechanics, the Tiger Cloud vs. Cloud SQL question in full.
- [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) — every environment variable,
  branch by branch.
- [`docs/BRANCHES.md`](./BRANCHES.md) — the git branching model this
  deployment topology sits on top of.
- `docs/services/*.md` — per-branch specifics (webhook auth, OAuth
  redirect URIs, Cloud Run deploy commands) referenced above.
