# Branching model — Vouch

Nine branches matter in this repo: production, and eight long-lived service
branches. This doc is the git-level view — how they relate, where they
diverged, and where that divergence has caused real (if mostly harmless)
inconsistency.

---

## 1. The convention (from the root `CLAUDE.md`)

> One repo, one shared database. Each onboarding step is its own
> **long-lived branch**, forked from production, staying deployed
> independently — not a short-lived feature branch meant to merge
> immediately. When a service is ready for real users, merge it into
> production (or promote it directly) rather than rebuilding it there.

Corollaries that follow from "long-lived, independently deployed":

- **Branches never import code from each other.** Anything one branch
  needs that another branch also needs — `lib/db.ts`, `lib/session-token.ts`,
  `lib/crypto.ts`, `middleware.ts`'s skeleton — is **copied**, not shared via
  a package or a monorepo path. This is deliberate: no branch can break
  another by editing a file it thinks is private. The cost, observed
  directly by diffing these files across branches while compiling this doc,
  is silent drift (§4) and — once, concretely — the same bug fixed three
  separate times by three different branches without any of them knowing
  the others had hit it (`docs/DATABASE.md` §4, the `users.name` column).
- **The shared database is the only thing actually shared.** Table
  ownership is a convention enforced by nobody but the people writing
  migrations — see `docs/DATABASE.md` §4 for the one branch
  (`identity-verification`) that deliberately breaks "each branch owns its
  tables" on purpose, and the `users` table, which by that same measure has
  no single owner at all.
- **A branch can reference infrastructure another branch owns without
  merging with it.** `calling-agent` calls the Cloud Run service that lives
  inside `voice-verification`'s tree; `dashboard` proxies to `calling-agent`'s
  deployed URL; `identity-verification`'s migration alters a table
  `voice-verification` created. None of this requires a merge — it works
  because the database and the deployed HTTP endpoints are the integration
  points, not the source tree.

---

## 2. Fork points and how far each branch has drifted

All nine branches converge on one shared history up to commit `24d36dd`
("Document the per-service branch/subdomain convention") — the point where
this convention was written down and every branch but one forked from.
`bank-connection` is the outlier: it forked **earlier**, at `7400233`
("Document Vercel auto-deploy setup"), before the convention doc existed
and before one later fix (`5054074`, lazily constructing the `pg` pool)
landed on production.

| Branch | Forked at | Commits ahead of fork point | First commit after forking |
|---|---|---|---|
| `bank-connection` | `7400233` (earlier fork point) | 14 | `a1e8360` — Add Plaid bank-connection integration |
| `portal` | `24d36dd` | 8 | `780f9c7` — Add portal branch: login, signup, onboarding, session issuance |
| `gmail-connector` | `24d36dd` | 6 | `da64bf4` — Scaffold gmail-connector service (ported from `aaditisinghal/vouch-aaditi`) |
| `dashboard` | `24d36dd` | 5 | `3c7153c` — Port vouch-ui dashboard: real /dashboard + mock /demo routes |
| `card-issuing` | `24d36dd` | 4 | `badb99e` — Add card-issuing service: disposable one-per-transaction Stripe cards |
| `calling-agent` | `24d36dd` | 11 | `9a3a64f` — Add calling-agent: outbound voice calls via Vapi + ElevenLabs + Gemini |
| `voice-verification` | `24d36dd` | 17 (most-iterated branch) | `989d2e3` — Scaffold voice-verification service (speaker verification + anti-spoofing) |
| `identity-verification` | `24d36dd` | 1 (youngest branch — single commit) | `0ea1f2a` — Add the identity-verification branch: Persona-backed proof of personhood |

Production (`claude/vigilant-meitner-fxqi9c`) has moved one commit further
since — `47ba38e`, "Document the whole system in one place" (the original
`ARCHITECTURE.md`) — which **no service branch has picked up**, since none
of them have been rebased on production after forking. This is expected
under the "long-lived, independent" model, but it means production's own
docs (that `ARCHITECTURE.md`, and now this `docs/` tree) describe the
system from the outside; no service branch's checkout contains them.

**`bank-connection` being the one branch forked from an older point is not
just a git curiosity.** Because it forked before `24d36dd`, it never
inherited the convention doc *as a commit in its own history* (it only
matches the convention because it was built to match it by hand), and its
fork predates the shared-`_migrations`-table pattern being explicitly
named as such. In practice this hasn't caused drift — `bank-connection`
still uses `db/migrations/`, still ships a byte-identical `scripts/migrate.mjs`
— but it's worth knowing this is the one branch whose lineage doesn't
literally pass through the commit that wrote down the rules it follows.

---

## 3. Two branches that don't fit the pattern

**`portal` is structurally its own thing**, not merely "one more service
branch." Per `docs/services/portal.md`: its very first commit after
forking (`780f9c7`) didn't add a portal *on top of* the inherited
`app/`/`lib/` scaffold — it **deleted that scaffold and replaced it
wholesale** with an app ported from a different, external source
(`aaditisinghal/vouch-aaditi`), which is why `portal` alone uses
`src/app/`, `src/lib/`, `src/components/` instead of the bare `app/`,
`lib/`, `components/` every other branch (including production) uses.
That same external origin is why `portal` alone runs meaningfully newer,
unpinned dependency versions (Next.js `16.3.5` vs. `15.5.25` pinned
everywhere else; React `19.2.8` vs. `19.1.1`; `typescript`/`tailwindcss` as
unpinned `^` ranges vs. exact pins elsewhere) and why it alone uses
`jsonwebtoken` + `bcryptjs` rather than `jose` — the only branch that
*mints* sessions and hashes passwords, everyone else only verifies.

**`gmail-connector`'s entire schema and sync pipeline is also a port**,
not original-to-this-repo work — every one of its 13 migrations says so in
its own header comment ("Adapted from
`aaditisinghal/vouch-aaditi/feature/gmail-connector`... removed there
before merge; ported here as its own service branch").

Put together: **at least two of the eight service branches
(`portal`, `gmail-connector`) are ports of a separate, external codebase**
rather than net-new work built against this repo's own scaffold — which
explains most of the structural inconsistency documented in §4 below. The
other six (`bank-connection`, `card-issuing`, `dashboard`,
`voice-verification`, `calling-agent`, `identity-verification`) were built
directly against this repo's shared scaffold and are structurally uniform
with each other and with production.

---

## 4. Observed drift in "copied" shared files

Diffing the files every branch is supposed to carry an independent copy of
confirms the model mostly works, with specific, named exceptions:

| File | Drift found |
|---|---|
| `lib/crypto.ts` | **Logic identical everywhere.** Only the error message (which doc it points to) and one doc-comment differ, branch to branch — cosmetic, by design. |
| `lib/session-token.ts` | **Functionally identical everywhere.** `gmail-connector`, `identity-verification`, `voice-verification` have the `SESSION_TTL_SECONDS` constant declared a few lines later than `bank-connection`, `calling-agent`, `card-issuing`, `dashboard` — pure line-ordering, not a logic change. |
| `scripts/migrate.mjs` | **Identical on all seven `db/migrations/`-style branches.** `portal` differs only in reading `migrations/` instead of `db/migrations/` (§3) — its own comment explains why the shared `_migrations` table stays safe regardless. |
| `middleware.ts` | **Intentionally different per branch** — each customizes `PROTECTED_PAGE_PREFIXES`, `PROTECTED_API_PREFIXES`, `EXEMPT_PATHS`, and the route `matcher` for its own routes. This isn't drift, it's the template working as designed: one shared skeleton (verify `vouch_session`, redirect signed-out visitors to `PORTAL_LOGIN_URL`), customized per branch for what it actually protects. |
| `users.name` (schema, not code) | **Discovered and fixed three separate times**, independently, by three different branches that never compared notes — see `docs/DATABASE.md` §4. The clearest evidence in this repo that "copied, not shared" has a real coordination cost, not just a theoretical one. |

---

## 5. Known inconsistencies worth resolving

Collected here because they're cross-branch by nature — no single service
doc is the right place for them:

1. **Migration `002` was never allocated on `portal`.** Its migrations run
   `001_create_users.sql` → `003_create_user_profiles.sql`. Confirmed (by
   `docs/services/portal.md`) never to have existed anywhere in the repo's
   full history, on any branch — not a deleted file, just a skipped
   number. Harmless (the runner sorts by filename, not by parsing the
   numeric prefix as a sequence), but worth a real `002_` migration next
   time one is needed on that branch, to close the gap rather than
   starting at `004`.
2. **`portal`'s own `CLAUDE.md` names the wrong subdomain.** It claims
   `portal` is bound to the bare apex domain (`getvouch.club`); the root
   `ARCHITECTURE.md` and every other branch's redirect env vars
   (`PORTAL_LOGIN_URL=https://login.getvouch.club/login`, consistently,
   across seven `.env.example` files) point at `login.getvouch.club`
   instead. `bank-connection`'s middleware fallback independently
   corroborates `login.getvouch.club`. Treat `portal`'s own `CLAUDE.md` as
   the stale one here.
3. **`?next=` is sent but never read.** `bank-connection` appends a
   `?next=` query param when redirecting a signed-out visitor to the
   portal, expecting to land back where the user left off; `portal`'s
   login/signup routes never read query params at all, and always forward
   to the fixed next onboarding step instead. Not a bug that breaks
   onboarding (the fixed next step is *also* correct for the primary
   flow), but the round-trip parameter is dead weight as currently wired.
4. **`GMAIL_CONNECTOR_URL` is referenced in `portal`'s code but absent
   from its `.env.example`** — anyone provisioning a fresh `portal`
   deployment from the example file alone would miss it.
5. **`DATABASE_URL` disagrees across `.env.example` files** — Tiger Cloud
   vs. GCP Cloud SQL vs. an unfilled placeholder, split roughly along
   "when did this branch last get its example file touched." Full account
   in `docs/DATABASE.md` §6.
6. **The same one-line `ALTER TABLE users ADD COLUMN name` migration
   exists, under different filenames, on two branches** (`card-issuing`,
   `dashboard`) — harmless because idempotent, but see item 6 above (same
   issue, cross-referenced from `docs/DATABASE.md` §4).

None of these are urgent — the system runs despite all of them — but
they're exactly the kind of thing that only becomes visible by reading
every branch side by side, which is what this documentation pass is for.

---

## 6. Related docs

- [`docs/DATABASE.md`](./DATABASE.md) — the schema-level consequences of
  this branching model (shared `_migrations` table, cross-branch schema
  touches).
- [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md) — how each branch maps to a
  Vercel deployment and subdomain.
- [`docs/ENVIRONMENT.md`](./ENVIRONMENT.md) — per-branch env vars,
  including the onboarding-chain URLs that stitch these independently
  deployed branches into one flow.
- `docs/services/*.md` — the full deep-dive per branch.
- Root [`ARCHITECTURE.md`](../ARCHITECTURE.md) — the product-level view;
  start there if you haven't read anything else yet.
