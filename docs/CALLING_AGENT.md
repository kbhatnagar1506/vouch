# Calling agent (Vapi + ElevenLabs + Gemini)

This branch (`calling-agent`) adds an outbound voice-call service: it
phones a Vouch user on the platform's behalf — either to collect/confirm
onboarding details, or to verify a specific purchase with the cardholder
directly (the phone-call equivalent of a bank's "did you just try to spend
$X at Y?" fraud check) — using [Vapi](https://vapi.ai) for call
orchestration and telephony, [ElevenLabs](https://elevenlabs.io) for the
assistant's voice, and (by default) Google Gemini as the reasoning model.
Everything that configures the call — the assistant's prompt, voice,
model, what it asks about, the webhook it reports back to — is defined in
code (`lib/calling-agent/`) and pushed to Vapi via its API, not clicked
together in Vapi's dashboard.

Two presets ship out of the box (`lib/calling-agent/assistant.ts`):

- **`onboarding_profile`** (default) — confirm/collect the fields on the
  portal's `user_profiles` table (address, employment, income, financial
  goal) over a natural conversation.
- **`purchase_verification`** — read back a specific transaction (passed
  as free-text `context` on the call — merchant, amount, card) and get a
  `confirmed`/`concern_reason` verdict back. This is the "calling-agent as
  a purchase check" use case: the `dashboard` branch's "Call me" button
  uses exactly this purpose (see its `docs/DASHBOARD.md` "Call me").

  This preset follows a specific conversation shape, not just a system
  prompt with the transaction details dropped in (`buildFirstMessage`/
  `buildSystemPrompt` in `lib/calling-agent/assistant.ts`):
  1. Opens with a time-of-day greeting ("Good morning/afternoon/evening")
     and asks how they're doing.
  2. Answers back briefly if asked in return, otherwise moves straight on
     without waiting for it.
  3. Gives a plain-language summary of this month's payment activity.
  4. Works in relevant past payment/subscription history — pulled from
     Backboard (see "Backboard context" below), not invented if there's
     nothing there.
  5. Gently asks about the specific renewal/reminder/check-in the call is
     about — low-pressure, mapped onto the `confirmed`/`concern_reason`
     fields it's collecting.

  It also handles a mismatched caller conversationally: if it becomes
  clear mid-call that whoever's on the line isn't actually the account
  holder, it says so plainly ("It looks like I'm not speaking with
  {name} — could you please hand the phone to them?") and ends the call,
  rather than continuing to discuss payment details with the wrong
  person. This is a real-time, conversational check based on what's said
  on the call — separate from (and faster than) the post-call speaker-match
  in "Human detection" below, which needs the full recording and so can
  only ever confirm identity after the call has already ended.

Pass your own `purpose`/`fields` for anything else — neither preset is
special-cased into the API, they're just the two included configurations.

## How it works

1. `POST /api/calling-agent/calls` (from `/calling-agent`, or any other
   client with a valid session) starts a call: it writes a `queued` row to
   `calling_agent_calls`, then calls Vapi's `calls.create` with the saved
   assistant (`VAPI_ASSISTANT_ID`) plus per-call
   [`assistantOverrides`](https://docs.vapi.ai) — the system prompt and
   structured-data schema for *this* call's purpose/fields, plus whatever
   free-text `context` was passed (e.g. the transaction being verified —
   see `lib/calling-agent/assistant.ts`'s `callOverrides()`). Defaults to
   the current user's `user_profiles.phone_number` if no number is given.
2. Vapi places the PSTN call, runs speech-to-text, the assistant's LLM
   turn, and ElevenLabs text-to-speech, and posts events back to
   `POST /api/calling-agent/webhook` as the call progresses
   (`status-update` for ringing/in-progress/ended, `end-of-call-report`
   once it's over with the transcript, recording, and extracted structured
   data).
3. The webhook handler verifies the request (see "Securing the webhook"
   below), updates `calling_agent_calls`, and logs every event verbatim to
   `calling_agent_events` for debugging. On `end-of-call-report`, it also
   calls `detectHuman()` (see "Human detection" below).
4. `/calling-agent` polls `GET /api/calling-agent/calls` while any call is
   still in flight and shows status, transcript, collected data, and the
   recording once available.

## Data model

See `db/migrations/0001_calling_agent_calls.sql`. Same approach as
`bank-connection`'s Plaid tables: typed columns for what we query on, the
complete raw Vapi payload kept in a `raw jsonb` column so nothing is lost
as the integration evolves.

- **`calling_agent_calls`** — one row per outbound call, created
  `queued` *before* Vapi is even called (so a failed API call still leaves
  an audit trail), then updated as webhook events arrive.
- **`calling_agent_events`** — append-only log of every webhook event
  Vapi sends for a call, raw payload included.

## The assistant: managed as code

`lib/calling-agent/assistant.ts` is the single source of truth:

- `baseAssistantConfig()` — the persistent parts (model, voice,
  transcriber, voicemail detection, the webhook URL/secret) — pushed to
  Vapi by `scripts/calling-agent/sync-assistant.ts`.
- `callOverrides()` — the per-call parts (what to ask about, for whom) —
  passed inline on every `calls.create`, via Vapi's `assistantOverrides`,
  so one saved assistant handles every call purpose instead of creating a
  new Vapi assistant per use case.
- `DEFAULT_INTAKE_FIELDS` — the out-of-the-box field list (age, address,
  employment status, income range, financial goal), chosen to mirror the
  portal branch's `user_profiles` columns
  (`migrations/003_create_user_profiles.sql`) since confirming/collecting
  exactly those by phone is the obvious first use of this service. Pass
  your own `fields`/`purpose` in the `POST /api/calling-agent/calls` body
  for anything else — this isn't special-cased to onboarding.

Run `npm run calling-agent:sync-assistant` after changing any of this (or
on first setup) to push it to Vapi. It upserts by assistant name
(`vouch-calling-agent`) so re-running it is always safe.

## Backboard context (purchase_verification only)

`app/api/calling-agent/calls/route.ts` looks up the caller's Backboard
assistant (`backboard_assistants`, owned by `gmail-connector` — read-only
here, this branch never creates one) and runs a top-k search
(`lib/calling-agent/backboard-context.ts`, a trimmed port of
`gmail-connector`'s `lib/backboard.ts` — only the search/read path, this
branch never writes a memory) using the request's `context` string as the
query. Whatever comes back is folded into the prompt as "Relevant payment
history," which step 4 of the `purchase_verification` conversation shape
above references. If the user has no Backboard assistant yet (Gmail never
connected) or Backboard errors, this is a silent no-op — the call still
goes through with just the `context` it was given, never blocked or
degraded by a Backboard outage. Needs `BACKBOARD_API_KEY` — already set
project-wide on Vercel Preview from `gmail-connector`'s own setup.

## Human detection: real speaker-matching against voice-verification

`lib/calling-agent/human-detection.ts` exports `detectHuman()`, called
from the webhook handler on every `end-of-call-report`. It answers two
separate questions:

- **`isHuman`** — is a live person on the line at all (not voicemail/an
  IVR)? Vapi's own built-in voicemail/IVR classifier
  (`voicemailDetection: { provider: "vapi" }`, set in
  `baseAssistantConfig()`) is the only signal for this, surfaced as
  `source: "vapi-voicemail-detection"`.
- **`isAccountOwner`** — if a human, is it specifically *this* Vouch
  user's voice? This is the one that actually matters for
  `purchase_verification` calls: confirming a charge means nothing if
  it's confirmed by whoever happens to answer the phone. Answered by
  fetching the call's recording, fetching that user's enrolled embedding
  from `voice_enrollments` (owned by the `voice-verification` branch,
  same shared DB), and calling that branch's `voice-inference` Cloud Run
  service's `/verify` endpoint — real ECAPA-TDNN speaker-matching, the
  exact same model and threshold voice-verification's own `/voice` page
  uses, not a new model built here. See
  `lib/calling-agent/voice-match.ts` (a trimmed port of that branch's
  `lib/voice-service.ts` — only `/verify` is needed here, not
  `/embed`/`/spoof-check`) and `lib/crypto.ts` (ditto, for decrypting the
  embedding — `ENCRYPTION_KEY` must match voice-verification's exactly).

`source` on the result tells you which path was taken:
`vapi-voicemail-detection` (voicemail, no speaker-match attempted),
`speaker-match` (ran and produced a verdict — see `speakerScore`),
`no-enrollment` (human confirmed, but this user never enrolled their
voice), `speaker-match-error` (fetching the recording or reaching
voice-inference failed), or `unimplemented` (no recording/user to check
yet, e.g. mid-call).

Deliberately not using voice-verification's anti-spoofing model
(`/spoof-check`, AASIST) here — that answers "live human vs. a
replay/clone," which is a different question from identity, and Vapi's
own voicemail detection already covers "is anyone really there." If a
"is this even a real live voice, not a clone/replay" check is ever
needed on top of identity, `/spoof-check` (see voice-verification's
`docs/VOICE.md`) is the natural place to add it — every caller already
goes through `detectHuman()`, so that would be another one-function
change, same as this one was.

## Setup

### 1. Get a Vapi account + API key

Sign up at https://dashboard.vapi.ai and grab a **Private** API key from
Settings → API Keys.

### 2. Buy or import a phone number

In the Vapi dashboard: Phone Numbers → buy a Vapi number, or import one
from Twilio/Vonage/Telnyx you already own. Copy its id into
`VAPI_PHONE_NUMBER_ID`.

### 3. Register your ElevenLabs and Gemini API keys with Vapi

These are account-level **Provider Keys** in Vapi (Settings → Provider
Keys), not something this branch's own env vars hold — Vapi calls
ElevenLabs/Google on your behalf using whatever key you register there.
This is the one manual/dashboard step in an otherwise code-driven setup
(at the time of writing, `@vapi-ai/server-sdk` doesn't expose a typed
`credentials` resource to script this step — if that changes, a
`scripts/calling-agent/` script to do this too would be a welcome
follow-up):
- ElevenLabs: paste your API key (from https://elevenlabs.io/app/settings/api-keys), provider "11labs".
- Google: paste your Gemini API key (from https://aistudio.google.com/apikey), provider "google".

Then set `ELEVENLABS_VOICE_ID` to a voice from your
[ElevenLabs Voice Library](https://elevenlabs.io/app/voice-library)
(defaults to ElevenLabs' stock "Rachel" voice if unset).

> **Gemini via Vertex AI / GCP service accounts**: Vapi's Google model
> provider currently takes a plain Gemini API key (AI Studio-style), not a
> GCP service-account/Vertex AI credential. If you specifically need Vertex
> AI (data residency, enterprise billing), that's not wired up here —
> using an AI Studio key is the supported path today.

### 4. Set environment variables

Locally (`.env`) and in Vercel (Project Settings → Environment Variables,
or `vercel env add <NAME> preview` — see "Deployment" below for why
*preview*): see `.env.example` for the full list and descriptions
(`VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `CALLING_AGENT_WEBHOOK_URL`,
`CALLING_AGENT_WEBHOOK_SECRET`, `ELEVENLABS_VOICE_ID`,
`CALLING_AGENT_MODEL_PROVIDER`/`CALLING_AGENT_MODEL`, plus the shared
`JWT_SECRET`/`SESSION_COOKIE_DOMAIN`/`PORTAL_LOGIN_URL` trio every service
branch needs).

### 5. Run the migration

```sh
npm run db:migrate
```

### 6. Sync the assistant to Vapi

```sh
npm run calling-agent:sync-assistant
```

First run creates the assistant and prints its id — set that as
`VAPI_ASSISTANT_ID` and re-run anytime `lib/calling-agent/assistant.ts`
changes (it updates the same assistant in place).

### 7. Assigning your subdomain

Once deployed, add your subdomain as a Vercel **Git Branch Domain** bound
to `calling-agent` (Project Settings → Domains — see the root `CLAUDE.md`
for the general pattern, and `docs/PLAID.md` for the worked Plaid
example). Then set `CALLING_AGENT_WEBHOOK_URL` to the real subdomain and
re-run the sync script so Vapi starts posting events to the real URL.

## Securing the webhook

Vapi's current API dropped the old inline `server.secret` →
`X-Vapi-Secret` mechanism in favor of a centrally-managed `credentialId`
that `@vapi-ai/server-sdk` doesn't yet expose as a typed resource. Instead,
`baseAssistantConfig()` sets a plain custom header
(`x-calling-agent-secret: CALLING_AGENT_WEBHOOK_SECRET`) on
`server.headers`, which Vapi echoes on every request it sends us; the
webhook route checks it with a constant-time comparison
(`lib/calling-agent/webhook-auth.ts`). Equivalent protection, fully
code-settable — no separate "create a credential" dashboard step.

## Deployment

Same pattern as every other service branch — push to `calling-agent` and
Vercel auto-deploys it (Preview by default; see the root `CLAUDE.md` and
`docs/PLAID.md`'s "Deployment" section for the full explanation of
Preview vs. Production and Git Branch Domains). Remember env vars are
per-environment: add everything in "Set environment variables" above to
the **Preview** environment (`vercel env add <NAME> preview`), since this
branch isn't the project's Production Branch.

Preview deployments sit behind Vercel's SSO-based Deployment Protection by
default, which blocks Vapi's webhook calls — disable protection for this
deployment (or use Vercel's "Protection Bypass for Automation" with the
bypass token/header) before `CALLING_AGENT_WEBHOOK_URL` will actually
receive events. This is security-relevant; decide it deliberately rather
than flipping it by default.

## Multi-tenancy

Same contract as every other service branch (`bank-connection`,
`voice-verification`, `gmail-connector`): reads the `vouch_session` cookie
the portal issues (HS256 JWT, `{ userId, email }`, shared `JWT_SECRET`,
`SESSION_COOKIE_DOMAIN=.getvouch.club`). `middleware.ts` protects
`/calling-agent` and `/api/calling-agent/*` (except the webhook, which
Vapi's servers call directly and authenticates via the header above, not a
session) and redirects signed-out visitors to `PORTAL_LOGIN_URL`. No auth
is implemented here — see the portal branch.

## Known gaps

- **Purchase verification is fire-and-forget today, not a blocking gate.**
  `POST /api/calling-agent/calls` returns as soon as Vapi accepts the
  call — the actual confirm/deny verdict (`structuredData.confirmed`)
  only lands later, via the webhook, once the call ends. A real
  "hold the purchase until confirmed" flow needs whatever triggers the
  call (a future temporary-card/purchase service) to either poll
  `GET /api/calling-agent/calls/:id` until `status: "ended"`, or have the
  webhook notify it directly — this branch doesn't do either of those
  since there's no purchase flow to wire into yet.
- **Human detection is a stub** — see "Human detection" above. For
  purchase verification specifically, the more relevant future check is
  less "is a human on the line" and more "is this the *account owner's*
  voice" — i.e. `voice-verification`'s speaker-matching (ECAPA-TDNN
  embeddings), not just its anti-spoofing model.
- **No rate limiting / abuse protection** on `POST /api/calling-agent/calls`
  — anyone with a session can place a call, which costs real money
  (Vapi + telephony + ElevenLabs + the LLM, per minute). Worth a per-user
  daily cap before this is open to real users.
- **`assistantId`/`phoneNumberId` are global env vars**, not per-user or
  multi-assistant — fine for one platform-operated calling agent, not
  set up for e.g. per-team assistants.
- **No retry** if `calls.create` fails transiently — the call row is just
  marked `failed` with the error message; retrying is a manual "call
  again" from the UI today.
- **Structured-data extraction isn't guaranteed** — it's an LLM pass over
  the transcript after the call (Vapi's `analysisPlan.structuredDataPlan`),
  not a hard schema validator. Treat `structuredData` as "probably right,"
  not "definitely right," until it's been checked against real calls.
