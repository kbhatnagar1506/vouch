# `identity-verification` branch

| | |
|---|---|
| **Subdomain** | `identity.getvouch.club` |
| **Branch** | `identity-verification` (ref: `origin/identity-verification`) |
| **Forked from** | `claude/vigilant-meitner-fxqi9c` at commit `24d36dd` |
| **Branch history** | One commit ahead of its fork point: `0ea1f2a` — "Add the identity-verification branch: Persona-backed proof of personhood" |
| **Third-party service** | [Persona](https://withpersona.com) — government ID + selfie liveness + phone verification |
| **Owns tables** | `identity_verifications`, `identity_verification_events` (plus one `alter table` on `voice_enrollments`, owned by `voice-verification` — see §6) |

This document was built by reading the branch's own `docs/IDENTITY.md` and
`CLAUDE.md` first, then verifying every claim against the actual code
(`git show origin/identity-verification:<path>` for every file, plus
targeted `git grep` across this and neighboring branches). Where the two
diverge, that's called out explicitly rather than smoothed over — see §1
and §6 in particular.

---

## 1. Purpose & role

Vouch's agent does two things that require a real, identified human behind
the account: it mints real virtual cards (`card-issuing`) and it places real
phone calls that authorize charges (`calling-agent`). This branch's job is
to replace two pieces of self-attested data with Persona-verified ones:

1. **Cardholder identity.** The legal name sent to Stripe Issuing previously
   came from whatever was typed into a signup form.
2. **Phone-call authorization.** The number the calling agent dials to
   confirm a charge also came from a form field — so anyone who compromised
   an account could change the number and then "confirm" every charge by
   answering their own phone. Enrolling their own voice on the
   `voice-verification` branch would defeat the speaker-match too, because
   that check only proves *the caller is whoever enrolled*, not *who that
   person actually is*.

Persona (government ID scan + selfie liveness + phone verification) closes
both gaps in one flow.

### Why this isn't onboarding step 5

Root `ARCHITECTURE.md` §6 ("Identity: why it isn't an onboarding step") and
this branch's own `docs/IDENTITY.md` ("Where it sits in onboarding:
nowhere") make **the same argument, in the same terms**. This branch's docs
are not a weaker or drifted copy of the root rationale — the two are
consistent:

| Claim | Root `ARCHITECTURE.md` §6 | Branch `docs/IDENTITY.md` |
|---|---|---|
| Self-attested cardholder name is a problem | "The cardholder name sent to Stripe Issuing came from a signup form field." | "The cardholder name came from whatever was typed at signup." |
| Self-attested phone number + voice enrollment together defeat the call-confirmation model | "Anyone who got into an account could change it and then approve every charge by answering their own phone. Enrolling their own voice defeats the speaker-match as well." | Same two sentences, same causal chain, stated as "Two consequences" 1 and 2. |
| Not a 5th onboarding step; triggers at first card mint instead | "It is **not** a fifth onboarding step — it triggers at **first card mint**, the moment the agent is about to spend." | "Deliberately **not** a fifth onboarding step... Verification is instead triggered at **first card mint**." |
| Reason framed as "concrete ask, not a toll booth" | "the reason for asking is concrete... Anyone who just wants to look around reaches the dashboard exactly as fast as before." | "The reason for the ask is then concrete and immediate, which is what stops it feeling like a toll booth." |
| Two-tier authority model | `unverified → OBSERVE`, `verified → ACT` | `observe` (nothing required) / `act` (inquiry `approved`) — same two tiers, named identically in `agentTier()` |
| Voice binding is "the point" | "**The voice binding is the point.**" | "This is the part that makes the integration worth more than a checkbox." |
| Data minimization: `is_over_18` instead of DOB | "notably `is_over_18` instead of the date of birth" | "`computeIsOver18()` does the comparison once and only the boolean is persisted" |

The branch doc is more detailed (it adds the Persona status-semantics
gotchas, the webhook-signature rotation handling, and a step-by-step Persona
dashboard setup guide that root `ARCHITECTURE.md` doesn't need), but the
core design rationale is faithfully carried over, not just asserted once at
the root and forgotten. See §6 below for whether the *code* backs this up
as thoroughly as the *docs* do — short answer: partially, and the gap is
exactly where you'd guess.

---

## 2. Full file / directory structure

```
identity-verification/
├── .env.example
├── CLAUDE.md                               (identical to root — branch/subdomain convention, not identity-specific)
├── app/
│   ├── layout.tsx                          Root layout — plain HTML shell, no identity-specific chrome
│   ├── page.tsx                            "/" → redirect("/verify"); this branch has exactly one page worth visiting
│   ├── globals.css                         Tailwind base styles
│   ├── verify/page.tsx                     The one real page: framing copy + <PersonaWidget/>, redirects to dashboard on success
│   └── api/
│       ├── auth/me/route.ts                GET → { user } from the session cookie (used by verify/page.tsx to show the signed-in email)
│       ├── health/route.ts                 GET → DB connectivity check (select now(), version())
│       └── identity/
│           ├── inquiry/route.ts            POST → creates a Persona inquiry server-side, returns inquiryId + sessionToken to the widget
│           ├── status/route.ts             GET → authoritative verified/tier read, reconciles with Persona for non-terminal statuses
│           └── webhook/route.ts            POST → Persona's async event delivery; HMAC-verified, writes identity + (on approval) binds voice enrollment
├── components/
│   └── PersonaWidget.tsx                   "use client" — loads Persona's embedded SDK, opens the inquiry, polls our own /status after completion
├── db/migrations/
│   └── 0001_identity_verifications.sql     identity_verifications + identity_verification_events + `alter table voice_enrollments add column persona_inquiry_id`
├── docs/
│   └── IDENTITY.md                         This branch's own design doc — read first as baseline (see §1)
├── lib/
│   ├── auth.ts                             Re-exports session-token primitives + getUserById() (needs `pg`, so kept out of middleware's Edge path)
│   ├── crypto.ts                           AES-256-GCM encrypt/decrypt helpers — copied from the shared template; **unused in this branch** (see §8, no identity data is encrypted at rest)
│   ├── db.ts                               Lazy-proxy Postgres pool (`pool`), shared shape used by every branch
│   ├── persona-schema.ts                   Pure logic: status semantics, `agentTier()`, inquiry→row shaping, webhook signature verification. No I/O — fully unit-tested.
│   ├── persona.ts                          I/O: Persona REST client (createInquiry/fetchInquiry) + all identity_verifications reads/writes + bindVoiceEnrollment()
│   ├── session-token.ts                    Edge-safe JWT verify/sign (`jose`), no `pg` import — shared session contract with the portal
│   └── session.ts                          getCurrentUser() / requireUser() for Server Components & route handlers (uses next/headers + lib/auth.ts)
├── middleware.ts                           Gates /verify and /api/identity/* on the session cookie; explicitly exempts /api/identity/webhook
├── next.config.ts                          Empty/default Next config
├── public/logo1.png                        Vouch wordmark, used on /verify
├── scripts/migrate.mjs                     Minimal SQL migration runner (applies db/migrations/*.sql in order, tracks in `_migrations`)
├── tsconfig.json                           Standard Next 15 strict TS config, `@/*` path alias
├── vitest.config.mts                       Node-environment Vitest config, `**/__tests__/**/*.test.ts`
├── lib/__tests__/persona-schema.test.ts    Unit tests for every rule in lib/persona-schema.ts (status semantics, DOB math, signature verification, parsing)
├── package.json / package-lock.json        Deps: next 15.5.25, react 19.1.1, jose, pg; devDeps: vitest, tailwindcss 4
└── .gitignore
```

No `app/dashboard`, no card UI, no calling UI — this branch is deliberately
thin: one page, three API routes under `/api/identity`, plus the two
carried-over utility routes (`auth/me`, `health`) every branch seems to
ship.

---

## 3. Persona integration

### 3.1 `lib/persona.ts` — the API client (I/O layer)

Talks to `https://api.withpersona.com/api/v1`, pinned to
`Persona-Version: 2025-12-08` (deliberately pinned rather than omitted — the
file's own comment explains that Persona's docs treat the header as
optional and falling back to a dashboard setting, which would let someone
silently change the response shape this code parses).

| Function | Role |
|---|---|
| `isConfigured()` | `true` iff both `PERSONA_API_KEY` and `PERSONA_TEMPLATE_ID` are set. Used to 501 the inquiry route gracefully instead of throwing. |
| `createInquiry(userId)` | `POST /inquiries` with `inquiry-template-id` from env, `meta["auto-create-account-reference-id"] = userId` (so Persona's Account, used later for `selfie_account_comparison` recovery, is keyed to our user id), and `auto-create-inquiry-session: true`. Returns `{ inquiryId, sessionToken }`. **Created server-side on purpose** — the client is never given a template id to build its own inquiry from, which would let it point the widget at a weaker template or attach a verification to someone else's account. |
| `fetchInquiry(inquiryId)` | `GET /inquiries/{id}?include=verifications`, piped through `parseInquiry()`. |
| `getIdentity(userId)` / `saveIdentity(userId, identity)` | Read/upsert `identity_verifications`. The upsert uses `coalesce(excluded.x, table.x)` per column, so a later partial update (e.g. a webhook that only carries a status change) never nulls out previously-captured name/address fields — except `phone_verified`, which is OR'd (`excluded.phone_verified or identity_verifications.phone_verified`) so it can only ever move from false to true, never revert. |
| `userIdForInquiry(inquiryId)` | The only way the webhook (which carries no session) maps an event back to a user. Requires the row to have been written at inquiry-creation time — see §4.3. |
| `recordEvent(inquiryId, eventName, payload)` | Appends to `identity_verification_events`, called for every webhook regardless of outcome. |
| `bindVoiceEnrollment(userId, inquiryId)` | The cross-branch write — see §6. |

`getIdentity()` catches its own query and returns `null` on failure (e.g.
migration not yet applied on a given DB) rather than throwing, so the
dashboard/status route degrades to `observe` instead of 500ing — the same
defensive pattern the codebase uses elsewhere (`dashboard-data.ts`, per the
code comment).

### 3.2 What Persona "template" / flow is used

Government ID + selfie liveness + phone verification, bundled into a single
Persona **inquiry template** (`PERSONA_TEMPLATE_ID`, an `itmpl_…` id chosen
in the Persona dashboard, not in this code). `docs/IDENTITY.md` setup step 3
spells out what the template must contain: *"The template should include
Government ID, Selfie, and Phone Number verifications."* The code doesn't
enforce that — it's a Persona-dashboard-side configuration contract, not
something `lib/persona.ts` can validate. `parseInquiry()` (§3.3) reads three
specific `included[].type` values off the response —
`verification/government-id`, `verification/selfie`,
`verification/phone-number` — which is the actual, code-level evidence for
which three verification types this integration expects the template to
run.

The inquiry is opened via Persona's **embedded widget** (their JS SDK), not
their hosted redirect flow — see §3.4.

### 3.3 `lib/persona-schema.ts` — parsing, typing, and the status rules

Deliberately pure (no `pg`, no `fetch`, no env reads) so every rule is
unit-testable without live Persona credentials or a DB. This is where the
integration's actual correctness lives:

- **`VERIFIED_STATUS = "approved"`**, and `isVerified()` checks *only* that.
  `completed` (user reached the final screen) is explicitly not treated as
  verified — the code comment and `docs/IDENTITY.md` both call this out as
  "the single most common way these integrations ship broken."
- **`isTerminal()`** — `approved | declined | failed | expired`. Used by the
  status route to decide whether it's worth re-polling Persona.
- **`agentTier(status)`** → `"observe" | "act"`. `"act"` iff
  `isVerified(status)`. This is the entire authority model described in
  root ARCHITECTURE.md §6's two-line diagram, expressed as one ternary.
- **`computeIsOver18(birthdate, now)`** — the only function that ever sees
  a real birthdate. Returns `true`/`false`/`null` (never guesses on missing
  or malformed input, on purpose — defaulting either way is unsafe: `false`
  wrongly locks out a real adult, `true` defeats the check). The birthdate
  itself is never put on the returned `VerifiedIdentity` object or stored
  anywhere.
- **`parseInquiry(raw, now)`** — turns a `GET /inquiries/{id}?include=…`
  response (or a webhook's embedded payload, same shape) into the narrow
  `VerifiedIdentity` type that's actually persisted: name, address,
  `isOver18`, `phoneVerified`, `selfieLivenessPassed`,
  `selfieDocumentSimilarity`. Government-ID-verification values are
  preferred over the inquiry's `fields` (which can be prefilled by us and
  edited by the user) — falls back to `fields` only when the ID verification
  didn't supply a given value. Returns `null` only when there's no usable
  inquiry id at all; anything else degrades field-by-field to `null` rather
  than throwing.
- **`verifyPersonaSignature(header, rawBody, secret)`** — see §9.
- **`webhookEventName()` / `webhookPayload()`** — pull `data.attributes.name`
  (e.g. `"inquiry.approved"`) and `data.attributes.payload` out of a webhook
  envelope.

### 3.4 Test coverage (`lib/__tests__/persona-schema.test.ts`)

Exercises every rule above directly, and is worth reading as the spec for
exact expected shapes:

- Status semantics: `approved` verified, `completed` explicitly **not**
  verified, all other statuses (`created/pending/failed/expired/declined/
  needs_review`, plus `""`/`null`/`undefined`) not verified.
- `agentTier`: `approved` → `act`; everything else (including
  `needs_review`) → `observe`.
- `computeIsOver18`: exact-boundary cases (18-today true, 18-tomorrow
  false, birthday-already-passed-this-year vs. not-yet) plus
  null/empty/garbage-date → `null`.
- `parseInquiry`: full-shape extraction against a realistic fixture
  (`inq_ABC123`, government-id verification for "Krishna Bhatnagar", a
  passed selfie with `document-similarity-score: 0.94`, a passed
  phone-number verification); asserts the serialized identity **never
  contains** the fixture's raw birthdate string or document number; prefers
  government-ID values over prefilled `fields`; falls back to `fields` when
  the ID didn't supply a value; liveness `failed` → `false`, `not_applicable`
  → `null`, missing verification → `null`; a non-`passed` or absent phone
  verification → `phoneVerified: false`; missing `included` degrades every
  field to `null`/`false` without throwing; only a genuinely missing/empty
  inquiry id returns `null` from the whole function; a missing `status`
  defaults to `"created"` (not verified).
- `verifyPersonaSignature`: accepts a correctly signed payload; accepts
  **either** pair during a simulated secret rotation (two space-separated
  `t=…,v1=…` chunks, old secret and new secret each verify against their
  own chunk); rejects a tampered body; rejects a signature computed over a
  mismatched timestamp; rejects null/undefined/empty/malformed headers and
  an empty secret; rejects a wrong-length signature **without throwing**
  (guards `timingSafeEqual`'s length-mismatch throw).
- Webhook envelope: reads event name + payload from a realistic
  `inquiry.approved` event; returns `null` on unrecognized shapes rather
  than throwing.

### 3.5 `components/PersonaWidget.tsx` — the embedded frontend flow

Client component. Loads Persona's **embedded SDK** (`persona-v5.8.0.js`,
pinned by exact version in `app/verify/page.tsx`, not in this file) rather
than bouncing the user to a `withpersona.com`-hosted page — kept in-app so
Vouch controls the framing copy around *why* it's asking.

Flow: `start()` → `POST /api/identity/inquiry` → constructs
`window.Persona.Client({ inquiryId, sessionToken, environmentId, onReady,
onComplete, onCancel, onError })` → `onReady` calls `client.open()`.

The important design point, called out in its own comment:
`onComplete`'s client-reported `status` is **never trusted** — it's
attacker-controllable and Persona's own semantics make `completed` mean
"reached the last screen," not "passed." Instead, `onComplete` triggers
`confirmWithServer()`, which polls `GET /api/identity/status` up to 8 times
at 1.5s intervals (~12s) waiting for `verified: true` or a terminal failure
status (`declined/failed/expired`); if neither happens in that window it
shows "Still reviewing... we'll email you when it's done" rather than
guessing. (No email-sending code exists in this branch — that line is
UI copy, not a wired notification; see §11 gaps.)

State machine: `idle → loading → open → checking → verified | failed |
error`, with a distinct "You're verified" panel replacing the button
entirely once `step === "verified"`.

---

## 4. API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/identity/inquiry` | POST | session required (401 if not) | Starts a verification: creates the Persona inquiry server-side, persists a placeholder row immediately, returns `{ inquiryId, sessionToken, environmentId }` to the widget |
| `/api/identity/status` | GET | session required (401 if not) | Authoritative read of verification state; reconciles with Persona's API for non-terminal statuses; returns `{ status, verified, tier, isOver18, phoneVerified, name }` |
| `/api/identity/webhook` | POST | **no session** — HMAC signature instead | Persona's async event delivery; verifies signature, logs every event, updates the row, binds the voice enrollment on approval |
| `/api/auth/me` | GET | session-derived, returns `null` if signed out | `{ user }` — used by `/verify` to show the signed-in email in the corner |
| `/api/health` | GET | none | `select now(), version()` — DB connectivity smoke test |

### 4.1 `POST /api/identity/inquiry`

1. `requireUser()` — 401 if no valid session.
2. `isConfigured()` check — if `PERSONA_API_KEY`/`PERSONA_TEMPLATE_ID` are
   missing, returns **501** with `"Identity verification is not configured.
   See docs/IDENTITY.md."` rather than a generic 500.
3. If the user already has an `approved` row, short-circuits with
   `{ alreadyVerified: true, status }` — explicitly to avoid burning another
   billed Persona verification or making someone redo the flow.
4. Calls `createInquiry(user.id)`.
5. **Writes the row to `identity_verifications` immediately**, before the
   user does anything in the widget — status `"created"`, everything else
   null/false. The code comment is explicit about why: the webhook only
   carries an inquiry id, no session, so this row is the only thing that
   later maps an event back to a user; writing it late would lose any
   verification a fast user completes before the row exists.
6. Returns `{ inquiryId, sessionToken, environmentId:
   NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID }` to the browser.

Error handling: `UnauthorizedError` → 401; anything else → 500 with the
error message.

### 4.2 `GET /api/identity/status`

1. `requireUser()` — 401 if no session.
2. Reads the stored row.
3. **If the stored status is non-terminal** (i.e. not one of
   `approved/declined/failed/expired`), calls `fetchInquiry()` against
   Persona live and re-saves if the status changed — this is the
   reconciliation path for a delayed or dropped webhook. Terminal statuses
   are never re-fetched (they can't change, and it would add latency to
   every dashboard load for nothing). A Persona-side failure here is
   swallowed (`catch {}`) and the route falls through to whatever was
   already stored — an outage degrades to `observe`, never 500s.
4. Returns `{ status, verified, tier, isOver18, phoneVerified, name }`,
   where `name` is `"${nameFirst} ${nameLast}"` trimmed, or `null` if no
   `nameFirst`.

This route is the one the branch's own docs and the root ARCHITECTURE.md
describe as what `card-issuing` should call before minting — see §7 for
whether it actually does.

### 4.3 `POST /api/identity/webhook`

Full trace, in order:

1. `rawBody = await request.text()` — **read as text before any parsing**,
   because the HMAC is computed over Persona's exact bytes; re-serializing
   parsed JSON reorders keys and breaks the signature.
2. If `PERSONA_WEBHOOK_SECRET` isn't set → **500**, fails closed rather than
   trusting an unsigned event.
3. `verifyPersonaSignature(header, rawBody, secret)` → **401** on failure.
4. Parse the body as JSON → **400** on malformed JSON.
5. Extract `eventName` (e.g. `"inquiry.approved"`) and `identity` (via
   `parseInquiry(webhookPayload(body))`).
6. `recordEvent(identity?.inquiryId ?? null, eventName, body)` — logs
   **every** event, verified or not, before acting on it.
7. If `identity` parsed successfully: look up `userIdForInquiry()`. If
   found: `saveIdentity(userId, identity)`, and **if** the new status is
   verified (`approved`), also `bindVoiceEnrollment(userId,
   identity.inquiryId)`.
8. Returns `{ ok: true }`, or a **500** on any handling error (deliberately,
   so Persona retries the delivery — the event is already logged either way
   by step 6).

Which events does it "handle"? All of them, uniformly — there's no
`switch (eventName)`. Any `inquiry.*` webhook whose payload parses to a
`VerifiedIdentity` gets `saveIdentity()`'d; the status field inside that
payload (`approved`, `declined`, `failed`, etc.) is what actually
determines the row's new state. `inquiry.approved` is the only event name
that additionally triggers `bindVoiceEnrollment()`, but that's a side
effect of checking `isVerified(identity.status) === true` after the save,
not a dispatch on the event name itself — so any event whose payload status
happens to read `approved` would also trigger the bind.

---

## 5. Data minimization — verified against the schema

Root `ARCHITECTURE.md` §6 claims: *"We store what Stripe needs for a
cardholder (name, address) plus derived booleans — notably `is_over_18`
instead of the date of birth... No document numbers, no birthdates, no ID
images."* This is **accurate** — confirmed by reading every column below.

Verbatim `CREATE TABLE identity_verifications` (from
`db/migrations/0001_identity_verifications.sql`):

```sql
create table if not exists identity_verifications (
  user_id text primary key references users(id) on delete cascade,
  inquiry_id text not null unique,
  account_id text,
  status text not null,

  name_first text,
  name_last text,
  address_street_1 text,
  address_street_2 text,
  address_city text,
  address_subdivision text,
  address_postal_code text,
  address_country_code text,

  is_over_18 boolean,
  phone_verified boolean not null default false,
  selfie_liveness_passed boolean,
  selfie_document_similarity double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Column-by-column against the claim:

| Column | Category | Matches "name/address + derived booleans" claim? |
|---|---|---|
| `user_id` | FK to `users(id)` | n/a — identifier |
| `inquiry_id`, `account_id` | Persona pointers, not PII payload | Yes — "the pointer back to the full record," not the record itself |
| `status` | raw Persona enum string | Yes — deliberately *not* mapped to a local enum, so a new Persona status can't silently read as terminal |
| `name_first`, `name_last` | legal name | Yes — exactly what's claimed (Stripe cardholder requirement) |
| `address_street_1/2, city, subdivision, postal_code, country_code` | address | Yes — exactly what's claimed |
| `is_over_18` | **derived boolean**, computed once by `computeIsOver18()` | Yes — this is the specific example the docs lead with; confirmed no `birthdate`/`dob` column exists anywhere in this table |
| `phone_verified` | derived boolean | Yes |
| `selfie_liveness_passed` | derived boolean | Yes |
| `selfie_document_similarity` | a **float** (the ID↔selfie face-match score), not raw biometric data or an image | Consistent with the claim, though it's a numeric field beyond the two booleans the docs specifically name — kept, per the migration's own comment, "as evidence for the voice binding... it records how strongly the face on the ID matched the live selfie at the moment identity was established" |

No `document_number`, no `birthdate`/`dob`, no photo/image URL, no
nationality, no sex — none of those columns exist. The claim holds exactly.

Second table, `identity_verification_events`:

```sql
create table if not exists identity_verification_events (
  id bigserial primary key,
  inquiry_id text,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
```

One caveat worth flagging plainly: `payload jsonb` stores **the entire raw
webhook body verbatim**, and Persona's actual webhook payloads (per
`lib/persona-schema.ts`'s own `government-id` verification shape) do
include birthdate and document number in the underlying JSON — those fields
are simply never *extracted* into `identity_verifications` by
`parseInquiry()`/`saveIdentity()`. So the minimization guarantee applies to
the structured, queried table (`identity_verifications`), not to
`identity_verification_events`, which is an intentional raw audit log (same
pattern as `calling_agent_events` per the migration's comment) but does
mean a DB compromise that reaches this second table would expose more than
the "no birthdates, no document numbers, no ID images" framing implies for
the *service* as a whole. This is a nuance the docs don't spell out.

---

## 6. The voice-binding mechanic — implemented, not just documented

This is the one piece of cross-branch behavior worth being precise about,
because the answer is more interesting than "aspirational vs. wired up" —
**it's genuinely implemented in code**, just not through imported code
(branches never import each other's code, per the architecture convention)
— through direct SQL against a table this branch doesn't own, which is the
sanctioned mechanism given they share one DB.

**Where it's implemented:**

1. **Migration** (`db/migrations/0001_identity_verifications.sql`, last
   statement):
   ```sql
   alter table voice_enrollments
     add column if not exists persona_inquiry_id text;
   ```
2. **Write path** (`lib/persona.ts`):
   ```ts
   export async function bindVoiceEnrollment(userId: string, inquiryId: string): Promise<void> {
     try {
       await pool.query("update voice_enrollments set persona_inquiry_id = $2 where user_id = $1", [userId, inquiryId]);
     } catch {
       // voice_enrollments is owned by the voice-verification branch and may
       // not exist on every DB.
     }
   }
   ```
3. **Call site** (`app/api/identity/webhook/route.ts`): called exactly once,
   only after `saveIdentity()`, only `if (isVerified(identity.status))` —
   i.e. only on an `approved` result.

This does exactly what both docs describe: on approval, the webhook writes
the Persona inquiry id onto the matching `voice_enrollments` row via a raw
`UPDATE`, cross-referencing a table owned by the `voice-verification`
branch by name. I confirmed that table actually exists with a matching
`user_id text primary key` column in `origin/voice-verification`'s own
`db/migrations/0001_voice_enrollments.sql`, so the query's column
assumptions are correct against that branch's real schema.

**Two honest caveats the docs don't mention:**

- **The `ALTER TABLE` is not itself guarded by `IF EXISTS` on the table.**
  `add column if not exists` only guards the *column*; if `voice_enrollments`
  doesn't exist yet at all (e.g. this migration is applied to a fresh DB
  before `voice-verification`'s own migration has run), the `ALTER TABLE`
  statement throws `relation "voice_enrollments" does not exist`, and per
  `scripts/migrate.mjs` the whole migration transaction rolls back —
  `identity_verifications` and `identity_verification_events` wouldn't get
  created either, since all three statements run in one transaction. This
  is a real ordering dependency between the two branches' migrations
  against the one shared DB, not called out anywhere in either branch's
  docs. In practice it's almost certainly fine, since `voice-verification`
  is an already-established branch and its migration has presumably already
  run against the shared DB — but it's a latent footgun for a genuinely
  fresh database.
- **The write is best-effort and silent on failure.** `bindVoiceEnrollment`
  swallows any error (missing table, or — just as plausible — no row for
  that `user_id` yet if the person verified identity before ever enrolling
  their voice, which is a normal ordering since voice enrollment happens
  earlier in the onboarding chain per `docs/IDENTITY.md`). Either way the
  `UPDATE` simply matches zero rows or throws, and the code doesn't
  distinguish the two or retry — a user who gets verified before enrolling
  their voice never gets the bind applied retroactively when they later do
  enroll. There's no code in either branch that backfills this.

So: **the mechanic is real, tested indirectly (the webhook route always
calls it on approval), and cross-checked as schema-compatible with the
actual voice-verification branch** — but it is fire-and-forget, has a
migration-ordering dependency, and has no backfill path for
verify-before-enroll users. Call it "implemented but fragile," not
"aspirational."

### Contrast: the *other* cross-branch link (identity → card-issuing) is NOT implemented

The task description's suspicion here is correct, and I checked it directly
rather than inferring it. `docs/IDENTITY.md`'s own "Still to do" section
lists, verbatim:

> - Feed the verified name/address into `card-issuing`'s `ensureCardholder()`
>   so Stripe receives verified KYC rather than self-reported data.
> - Gate the mint action on `agentTier() === "act"`.

I confirmed this with `git grep` on both sides:

- **This branch** exposes the pieces a caller would need
  (`GET /api/identity/status` returning `tier`, and `agentTier()` in
  `lib/persona-schema.ts`) but contains **no route, no server action, and
  no redirect that fires from a card-mint event** — there's no code here
  that knows `card-issuing` exists at runtime, only in prose (docs and code
  comments referencing `card-issuing`'s `lib/stripe-mint.ts` and
  `ensureCardholder()` by name, never by import or HTTP call).
- **`origin/card-issuing`** (checked directly): `git grep -l "identity\|Persona\|persona\|agentTier"` across its entire tree returns **zero
  matches**. Its card-minting routes
  (`app/api/cards/route.ts`, `app/api/cards/[id]/*`) have no reference to
  identity verification, Persona, or `agentTier` at all.

So "triggers at first card mint" is **pure design intent** as of this
commit — true on neither side of the intended integration. The `/verify`
page's own copy even hints this was written aspirationally ahead of the
trigger existing: *"Vouch is about to mint a card and make calls on your
behalf"* is framing copy for a flow nothing currently routes a user into
automatically — today the only way to reach `/verify` is a direct,
manually-typed visit to `identity.getvouch.club/verify` while signed in.
This matches what the task brief predicted: card-issuing is a separate
branch, and as of this one-commit-old branch, there is no actual code-level
trigger anywhere — only the `agentTier()` primitive and the `/status`
endpoint the eventual gate would presumably call.

---

## 7. Database schema (verbatim)

Full contents of `db/migrations/0001_identity_verifications.sql`:

```sql
-- Persona (withpersona.com) identity verification.
--
-- `users.id` is TEXT everywhere in this shared DB (see the portal branch's
-- CLAUDE.md for why), so it's referenced the same way here.
--
-- DATA MINIMIZATION IS THE POINT OF THIS SCHEMA. Persona's government-ID
-- verification returns far more than what's below — full birthdate,
-- document number, issue/expiry dates, nationality, sex, and photograph
-- URLs. None of that is stored here. We keep only:
--   * what Stripe Issuing actually requires to create a cardholder
--     (legal name + address — see card-issuing's lib/stripe-mint.ts), and
--   * derived booleans for everything else.
-- Most importantly `is_over_18` instead of the birthdate: the age check is
-- the only thing we need the DOB *for*, so we do the comparison once, keep
-- the answer, and discard the input. Persona remains the system of record;
-- `inquiry_id` is the pointer back to the full record if it's ever needed
-- for a dispute. A breach of this table leaks no document numbers, no
-- dates of birth, and no ID images.

create table if not exists identity_verifications (
  user_id text primary key references users(id) on delete cascade,
  -- Persona inquiry (inq_...). Unique: one live inquiry per user — a
  -- re-verification replaces the row rather than accumulating rows, and the
  -- event log below keeps the history.
  inquiry_id text not null unique,
  -- Persona account (act_...) — groups a person's inquiries across
  -- re-verifications. This is what makes account recovery possible later.
  account_id text,
  -- Persona's inquiry status verbatim (created/pending/completed/failed/
  -- expired/approved/declined/needs_review). Stored raw rather than mapped
  -- to our own enum so a new Persona status can't silently read as a
  -- terminal one. NOTE: only `approved` means verified — `completed` just
  -- means the user reached the final screen. See lib/persona-schema.ts.
  status text not null,

  -- Verified identity, for Stripe Issuing cardholder creation.
  name_first text,
  name_last text,
  address_street_1 text,
  address_street_2 text,
  address_city text,
  address_subdivision text,
  address_postal_code text,
  address_country_code text,

  -- Derived, never the raw inputs.
  is_over_18 boolean,
  phone_verified boolean not null default false,
  selfie_liveness_passed boolean,
  -- Persona's selfie<->government-ID face match metric. Kept as evidence
  -- for the voice binding below: it records how strongly the face on the
  -- ID matched the live selfie at the moment identity was established.
  selfie_document_similarity double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every webhook Persona sends, logged verbatim before it's acted on. Same
-- pattern (and same reasoning) as the calling-agent branch's
-- `calling_agent_events`: when a third-party integration misbehaves, the
-- raw payload is the only thing that settles what actually happened.
create table if not exists identity_verification_events (
  id bigserial primary key,
  inquiry_id text,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists identity_verification_events_inquiry_idx
  on identity_verification_events (inquiry_id, created_at desc);

-- The voice binding: ties a voice enrollment (owned by the
-- voice-verification branch) to the Persona inquiry that proved who the
-- enroller actually is. Without this, `voice_enrollments` proves only that
-- the voice on a call matches the voice that enrolled — it says nothing
-- about whose voice that is. With it, every later speaker-match inherits a
-- government-ID check, which is what lets the calling agent treat a phone
-- confirmation as authorization to spend.
--
-- Nullable and added here rather than in voice-verification's own
-- migration: enrollment happens earlier in onboarding than verification
-- (see docs/IDENTITY.md), so the column is populated after the fact.
alter table voice_enrollments
  add column if not exists persona_inquiry_id text;
```

Applied via `npm run db:migrate` → `scripts/migrate.mjs`, which tracks
applied filenames in a `_migrations` table and wraps each file in a single
transaction (see the ordering caveat in §6).

---

## 8. Environment variables

Cross-referenced `git grep "process\.env\."` across the whole branch
against `.env.example`. Every variable actually read by the code:

| Variable | Read in | Purpose | In `.env.example`? |
|---|---|---|---|
| `DATABASE_URL` | `lib/db.ts`, `scripts/migrate.mjs` | Shared Postgres connection string (Tiger/Cloud SQL) | Yes |
| `JWT_SECRET` | `lib/session-token.ts` | Verifies the `vouch_session` cookie the portal issues — must exactly match the portal's value | Yes |
| `SESSION_COOKIE_DOMAIN` | `lib/session-token.ts` (`sessionCookieOptions()`) | `.getvouch.club` so the cookie is readable across subdomains; only relevant if this branch ever sets/clears the cookie itself (local testing) | Yes |
| `NODE_ENV` | `lib/session-token.ts` | `secure` cookie flag gate (standard Next/Node var, not service-specific) | No (implicit) |
| `PORTAL_LOGIN_URL` | `middleware.ts` | Where to redirect a signed-out visitor (this branch has no login UI of its own); defaults to `https://login.getvouch.club/login` if unset | Yes |
| `NEXT_PUBLIC_DASHBOARD_URL` | `app/verify/page.tsx` | Where to send the user after a successful verification (1.6s delay, then `window.location.href`) | Yes |
| `PERSONA_API_KEY` | `lib/persona.ts` (`requiredEnv`, `isConfigured`) | Server-side Persona API key (`persona_sandbox_…` / `persona_production_…`); Bearer-auth on every Persona API call | Yes |
| `PERSONA_TEMPLATE_ID` | `lib/persona.ts` (`createInquiry`, `isConfigured`) | The `itmpl_…` inquiry template (must bundle Government ID + Selfie + Phone Number checks); chosen server-side only, never accepted from the client | Yes |
| `NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID` | `app/api/identity/inquiry/route.ts` (returned to the browser, consumed by the widget) | The `env_…` Persona environment id (sandbox vs. production), read client-side by the embedded SDK | Yes |
| `PERSONA_WEBHOOK_SECRET` | `app/api/identity/webhook/route.ts` | HMAC secret for verifying `Persona-Signature`; missing value → webhook route fails closed with 500 | Yes |

**Declared in `.env.example` but not read by any code in this branch** (via
`process.env.`):

| Variable | Note |
|---|---|
| `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Only the non-public `PORTAL_LOGIN_URL` is actually used (server-side, in `middleware.ts`). The `NEXT_PUBLIC_` counterpart is documented but dead — nothing reads it client-side. |

**Read by code present in this branch but absent from `.env.example`:**

| Variable | Note |
|---|---|
| `ENCRYPTION_KEY` | Required by `lib/crypto.ts`'s `getKey()` (throws if unset — points to `docs/VOICE.md`, another branch's doc, confirming this file is a carried-over copy). Not in `.env.example`, and — see below — never actually invoked anywhere in this branch, so its absence from `.env.example` doesn't hurt anything in practice. |

`lib/crypto.ts` (`encryptSecret`/`decryptSecret`) is present per the "shared
logic is copied per branch" convention but **`git grep` confirms
`encryptSecret`/`decryptSecret` are called nowhere in this branch** — no
column in `identity_verifications` is encrypted at rest (everything is
plain `text`/`boolean`/`double precision`), which tracks: this branch's
whole design point is to store *less* sensitive data, not to encrypt
sensitive data. `lib/crypto.ts` is inert boilerplate here, not a discrepancy
in behavior — just an unused file.

Setup instructions for obtaining each Persona-specific value are in the
branch's `docs/IDENTITY.md` "Setup" section (steps 1–6), not repeated here.

---

## 9. Webhook authentication — how it verifies the request is really from Persona

`app/api/identity/webhook/route.ts` delegates the actual check to
`verifyPersonaSignature()` in `lib/persona-schema.ts`. Mechanics:

- Persona sends a `Persona-Signature` header shaped like
  `t=<unix_ts>,v1=<hex_hmac>` — and **during a secret rotation, two
  space-separated pairs**, e.g. `t=…,v1=<old> t=…,v1=<new>`.
- The signed string is `"{t}.{rawBody}"`, HMAC-SHA256 with
  `PERSONA_WEBHOOK_SECRET`, hex-encoded.
- The route reads the body with `request.text()` — **before** any
  `JSON.parse` — because `JSON.stringify(JSON.parse(body))` would reorder
  keys/whitespace and the signature would never match a re-serialized body.
- `verifyPersonaSignature` splits the header on whitespace, and for **each**
  chunk independently extracts `t=` and `v1=` via regex, recomputes the
  expected HMAC, and compares — accepting on the **first** chunk that
  matches. This is what makes secret rotation safe: during the rotation
  window, a webhook signed with either the old or the new secret still
  verifies, since the code iterates every chunk rather than only checking
  the first.
- Comparison uses `timingSafeEqual` (constant-time), but only after first
  checking `expected.length === signature.length` — `timingSafeEqual`
  throws on a length mismatch, so that check has to happen first, and the
  test suite specifically verifies a wrong-length signature returns `false`
  rather than throwing and crashing the route.
- **Fails closed**: if `PERSONA_WEBHOOK_SECRET` isn't set at all, the route
  returns 500 immediately, before ever looking at the signature — it never
  falls back to trusting an unsigned request. The doc and code comments are
  explicit that an accepted unsigned webhook would let anyone who discovers
  the URL mark themselves `approved`, which is what unlocks agent spending.
- A bad/missing/malformed signature → **401**, and the request is not
  processed further (no DB write happens before signature verification).

No IP allowlisting, no mTLS — signature verification is the entire trust
boundary, which matches Persona's own documented webhook security model.

---

## 10. Auth, session, and multi-tenancy (shared scaffolding, briefly)

Same contract as every other branch (confirmed identical in shape to what
root `ARCHITECTURE.md` §3 describes): the `portal` branch is the sole
issuer of the `vouch_session` cookie (HS256 JWT, `.getvouch.club`); this
branch only verifies it, via the shared `JWT_SECRET`, and never issues one
(`createSessionToken()` in `lib/session-token.ts` exists but is explicitly
commented "for local testing only").

- `lib/session-token.ts` — Edge-safe (no `pg` import), used directly by
  `middleware.ts`.
- `lib/session.ts` — `getCurrentUser()` / `requireUser()`, used by Server
  Components and route handlers (needs `next/headers` + a DB read via
  `lib/auth.ts`'s `getUserById()`).
- `middleware.ts` — `matcher: ["/verify/:path*", "/api/identity/:path*"]`.
  Explicitly exempts `/api/identity/webhook` from the session check first
  (Persona carries no cookie), then redirects unauthenticated page requests
  to `PORTAL_LOGIN_URL` (with a `?next=` back-link) and 401s unauthenticated
  API requests. Sets `x-user-id` as a fast-path hint header, but every
  downstream handler still re-verifies the cookie itself via
  `getCurrentUser()` rather than trusting that header.

---

## 11. Honest summary — design intent vs. implemented reality

| Design claim (from docs) | Implemented in code? | Evidence |
|---|---|---|
| Not a 5th onboarding step, triggers at first card mint | **Docs only.** No code anywhere (this branch or `card-issuing`) fires a redirect, check, or gate at mint time. | `docs/IDENTITY.md`'s own "Still to do" lists both halves of this as undone; `git grep` on `card-issuing` for identity/Persona/agentTier returns nothing |
| Two-tier `observe`/`act` authority model | **Implemented as a primitive**, not yet consumed by a gate | `agentTier()` exists, is unit-tested, and is returned by `/api/identity/status` — but nothing calls that endpoint to actually block a mint or a call |
| Voice enrollment gets bound to the Persona inquiry on approval | **Implemented**, with caveats | `bindVoiceEnrollment()` runs on every `approved` webhook; migration adds the column cross-branch; verified schema-compatible against `voice-verification`'s real table; but fire-and-forget, no backfill, and the migration has an unguarded ordering dependency on `voice_enrollments` already existing |
| `approved` (not `completed`) is the only verified status | **Implemented and tested** | `isVerified()`, dedicated test, called out in three separate places (code comment, migration comment, docs) |
| Webhook is the source of truth over client-reported state | **Implemented** | `PersonaWidget.tsx` explicitly ignores `onComplete`'s status and polls the server instead |
| Data minimization (name/address + booleans, no DOB/doc#/images) | **Implemented and verified against the literal schema** | See §5 — claim holds for `identity_verifications`; caveat that the raw webhook audit log (`identity_verification_events`) does retain full payloads |
| Webhook signature verification, incl. rotation handling | **Implemented and thoroughly tested** | §9, and the most heavily unit-tested piece of this branch |
| Feed verified name/address into `card-issuing`'s `ensureCardholder()` | **Not implemented** | Listed verbatim in `docs/IDENTITY.md` "Still to do"; no such call exists anywhere |
| Step-up re-verification on `isAccountOwner: false` from a call | **Not implemented** | Listed in "Still to do"; no such code path exists |
| Account recovery via `selfie_account_comparison` | **Not implemented** | Listed in "Still to do"; `auto-create-account-reference-id` is wired (a prerequisite), but no recovery flow calls Persona for a comparison |

**Bottom line:** this branch is honest about its own gaps — its own "Still
to do" list in `docs/IDENTITY.md` names exactly the pieces that are
missing, and cross-checking against `card-issuing` confirms those really
are missing on the other side too, not just deferred in this branch's
prose. What *is* built (the Persona client, the status-semantics logic, the
webhook signature verification, the minimized schema, and the voice-binding
write) is built carefully and is well-tested. What's *not* built is
specifically the wiring that would make "triggers at first card mint" true
at runtime — today, verification only happens if a signed-in user
navigates to `identity.getvouch.club/verify` directly; nothing in the
product currently sends them there.
