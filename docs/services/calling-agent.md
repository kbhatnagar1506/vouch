# Service: `calling-agent`

Outbound voice calls — Vapi (orchestration/telephony) + ElevenLabs (voice) +
Google Gemini (reasoning) — that phone a Vouch user to confirm a charge, or
to collect/confirm onboarding details, before money moves. Per the root
`ARCHITECTURE.md`, this is Vouch's headline feature: *"the agent spends real
money, and phones you to confirm a charge before money moves."*

| | |
|---|---|
| Branch | `calling-agent` (ref: `origin/calling-agent`) |
| Subdomain | `callingagent.getvouch.club` |
| Forked from | `claude/vigilant-meitner-fxqi9c` (production) |
| Deploys to | Vercel *Preview* environment (not Production) |
| Owns tables | `calling_agent_calls`, `calling_agent_events` |
| Third parties | Vapi (calls), ElevenLabs (TTS, via Vapi), Google Gemini (reasoning, via Vapi), Backboard.io (read-only memory search), `voice-verification`'s Cloud Run service (speaker-match) |
| Calling agent's spoken name | **Hale** (see §4 — not the same as the ElevenLabs voice actually used) |

This document was compiled by reading the branch's own `docs/CALLING_AGENT.md`
and `CLAUDE.md` as a baseline, then verifying and deepening every claim
against the actual code on `origin/calling-agent` and its commit history.
Where the two disagree, or where the code has a rough edge the branch's own
docs don't mention, it's called out explicitly — see §12.

---

## 1. Purpose & role

Two conversation "presets" ship out of the box, both defined in
`lib/calling-agent/assistant.ts` and selected by a `purpose` string that any
caller of `POST /api/calling-agent/calls` can override:

- **`onboarding_profile`** (the default) — confirm/collect the fields on the
  portal branch's `user_profiles` table (age, phone, address, employment,
  income, financial goal) over a natural conversation.
- **`purchase_verification`** — read back a specific transaction (passed as
  free-text `context`, e.g. *"a $42.50 charge at Acme Hardware on the card
  ending 1234, made 3 minutes ago"*) and get back a `confirmed` /
  `concern_reason` verdict. This is the phone-call equivalent of a bank's
  *"did you just try to spend $X at Y?"* fraud check, and it's what the
  dashboard branch's **"Call me"** button uses.

Neither preset is special-cased into the API — `purpose`, `fields` (the
intake/structured-data schema), and `context` (free text) are three
independent inputs a caller can mix and match. See §6 for a real
consequence of that independence.

### How the dashboard's "Call me" button reaches this branch

Confirmed by reading `dashboard`'s own `docs/DASHBOARD.md` ("Call me
(proxies to the `calling-agent` branch)") alongside this branch's code:

1. The dashboard's Sidebar "Call me" button hits `dashboard`'s own
   `app/api/dashboard/call-me/route.ts`.
2. That route does **not** talk to Vapi itself — it forwards the request
   server-to-server to **this branch's** `POST /api/calling-agent/calls`,
   re-sending the caller's own `vouch_session` cookie on the request. It
   sets `purpose: "purchase_verification"` and passes the subscriptions
   currently needing a decision as free-text `context`.
3. This branch's `middleware.ts` and `lib/session.ts` verify that forwarded
   cookie exactly like a normal browser request — same `verifySessionToken()`
   (`lib/session-token.ts`), same shared `JWT_SECRET`. `requireUser()`
   resolves the identical `{userId, email}` the dashboard already had. There
   is **no separate service-to-service auth and no CORS** — this is
   confirmed in code, not just asserted in docs: `middleware.ts` gates
   `/api/calling-agent/*` on the same `vouch_session` cookie as everything
   else, and nothing in this branch checks an API key, HMAC, or `Origin`
   header on the `/calls` routes.

**One important precision the task brief's phrasing glosses over:** this
"shared cookie, no separate auth" story is true for `/api/calling-agent/calls`
and `/api/calling-agent/calls/[id]` — the routes a Vouch-session holder (the
dashboard, proxying a user, or this branch's own `/calling-agent` page) calls.
It is **deliberately not true** for `/api/calling-agent/webhook`: Vapi's
servers call that route directly and never carry a `vouch_session` cookie at
all, so `middleware.ts` explicitly exempts it from the cookie check
(`EXEMPT_PATHS`) and it authenticates itself a completely different way — a
shared-secret header (see §5.3). Two auth mechanisms on one branch, each
matched to who's actually calling.

---

## 2. File & directory structure

```
app/
  api/
    auth/
      logout/route.ts          POST  — clears the vouch_session cookie
      me/route.ts               GET  — { user } from the current session, or null
    calling-agent/
      calls/route.ts            POST /api/calling-agent/calls  — place a call
                                 GET  /api/calling-agent/calls  — list the user's calls
      calls/[id]/route.ts       GET  /api/calling-agent/calls/:id — one call's detail
      webhook/route.ts          POST /api/calling-agent/webhook — Vapi call-event sink
    health/route.ts             GET  — DB connectivity check (select now(), version())
  calling-agent/page.tsx        The service's own UI: place a call, poll + inspect history
  layout.tsx                    Root HTML shell (title "Vouch")
  page.tsx                      "/" — a bare DB-health-check page (hackathon scaffold, not product UI)
  globals.css                   Tailwind import + minimal reset

db/migrations/
  0001_calling_agent_calls.sql       creates calling_agent_calls + calling_agent_events
  0002_calling_agent_calls_context.sql   adds calling_agent_calls.context

docs/
  CALLING_AGENT.md              This branch's own setup/architecture doc (see baseline note above)

lib/
  auth.ts                       User lookup (getUserById) + re-exports session-token.ts's primitives
  calling-agent/
    assistant.ts                 Single source of truth for the Vapi assistant: prompt, voice,
                                  model, structured-data schema, webhook wiring (§4, §5, §6)
    backboard-context.ts          Read-only, trimmed port of gmail-connector's Backboard client —
                                   top-k memory search only, never writes
    calls.ts                      All calling_agent_calls / calling_agent_events DB access
    human-detection.ts            detectHuman() — voicemail check + real speaker-match verdict
    voice-match.ts                Client for voice-verification's Cloud Run /verify endpoint
    webhook-auth.ts                Constant-time check of the shared webhook secret header
  crypto.ts                      AES-256-GCM decrypt (ported verbatim from voice-verification;
                                  needed to read voice_enrollments.embedding)
  db.ts                          Shared lazy pg Pool (proxy pattern — see bank-connection's copy)
  session.ts                     getCurrentUser() / requireUser() for Server Components & routes
  session-token.ts               Edge-safe JWT verify/sign (no DB import — used from middleware.ts)
  vapi.ts                        Lazy-constructed VapiClient singleton

middleware.ts                   Edge middleware: gates /calling-agent and /api/calling-agent/*
                                 on the session cookie, except the webhook path

scripts/
  calling-agent/
    place-test-call.ts            Ad-hoc: places one real call straight through Vapi's API,
                                   polls until it ends, prints transcript/structured data/recording
    sync-assistant.ts              Pushes lib/calling-agent/assistant.ts's baseAssistantConfig()
                                    to Vapi (create-or-update by assistant name)
  migrate.mjs                    Generic migration runner (applies db/migrations/*.sql in order,
                                  tracked in a _migrations table) — shared shape across all branches
```

Boilerplate not itemized above (present but not calling-agent-specific):
`.env.example`, `.gitignore`, `next.config.ts` (empty config), `package.json`
/ `package-lock.json`, `postcss.config.mjs` (Tailwind 4 plugin), `public/logo1.png`,
`tsconfig.json`. `CLAUDE.md` at the repo root is the same file on every
branch (the per-service-branch convention doc); this branch's copy also has
a short "Calling agent" section describing itself.

There are **no automated tests** on this branch (no `*.test.ts` files
anywhere in the tree) — the only test tooling is the two manual scripts
under `scripts/calling-agent/`, run by hand against real Vapi/ElevenLabs
accounts (see §8, §11).

---

## 3. The call pipeline, end to end

1. **A caller with a valid session** — a person on this branch's own
   `/calling-agent` page, or the `dashboard` branch's "Call me" button
   forwarding a session cookie server-to-server (§1) — sends
   `POST /api/calling-agent/calls` with at minimum a `purpose` (or accepts
   the `onboarding_profile` default); `purchase_verification` calls also
   send free-text `context` describing the transaction.

2. **Phone number resolution.** If the request didn't include `toNumber`,
   `app/api/calling-agent/calls/route.ts` looks up
   `user_profiles.phone_number` for the current user (`defaultPhoneNumber()`
   — best-effort: a missing `user_profiles` table or row just yields `null`,
   caught and swallowed, not a 500). No number either way → `400`.

3. **Backboard enrichment (`purchase_verification` + `context` only).** If
   `purpose === "purchase_verification"` **and** a `context` string was
   given, the route calls
   `topKPaymentContext(userId, context, k=5)`
   (`lib/calling-agent/backboard-context.ts`), using `context` itself as the
   search query:
   - Looks up `backboard_assistants` (owned by `gmail-connector`, read-only
     here) for this user's `assistant_id`. No row (Gmail never connected) →
     `[]`, silently.
   - `POST`s `https://app.backboard.io/api/assistants/{assistantId}/memories/search`
     with `{query: context, limit: 5}` (`X-API-Key: BACKBOARD_API_KEY`).
   - Any error (network, non-2xx, missing key) is caught, logged, and
     treated as `[]` — Backboard being down never blocks placing the call.
   - If memories came back, `formatMemoriesForPrompt()` renders them as a
     numbered list and the route builds
     `promptContext = "${context}\n\nRelevant payment history:\n${history}"`.
   - **Only `promptContext` (sent to Vapi) gets the Backboard addition** —
     the `calling_agent_calls.context` column stores the caller's original,
     un-enriched `context` string. The Backboard-augmented text that Hale
     actually reasons over is never persisted anywhere in this branch's DB.

4. **The call row is written first, before Vapi is ever called** —
   `insertCall()` inserts a `status='queued'` row into `calling_agent_calls`
   with `user_id`, `to_number`, `purpose`, `intake_schema` (the `fields`
   array, JSON), and `context` (raw, per above). This guarantees an audit
   trail even if the next step fails.

5. **The system prompt and first message are built** (`buildSystemPrompt()`,
   `buildFirstMessage()` in `lib/calling-agent/assistant.ts`) and packaged as
   Vapi `assistantOverrides` via `callOverrides()`. For `purchase_verification`,
   the conversation is a fixed five-step shape (see the literal step list the
   prompt gives the model):
   1. Opens with a time-of-day greeting (`Good morning/afternoon/evening`,
      computed from `Date.getUTCHours()` — server clock, no per-user
      timezone on file) and "How are you doing today?" — this exact text is
      the **first message**, spoken immediately on connect
      (`firstMessageMode: "assistant-speaks-first"`) rather than generated
      by the model, so the call never opens in dead air.
   2. If asked back, answer briefly and warmly; if not asked, move on
      without waiting.
   3. Give a short, plain-language summary of this month's payment activity.
   4. Naturally work in the "Relevant payment history" from step 3 above —
      conversationally, not read as a list — and skip this step outright if
      there's nothing there (never invent history).
   5. Gently ask about the specific renewal/reminder this call is about —
      low-pressure, mapped onto the `confirmed`/`concern_reason` fields
      being collected (§6).

   Before any of that, the prompt always opens with an identity step:
   introduce yourself by name and company, then either confirm you're
   speaking with `customerName` (if known) or ask who you're speaking with
   (if not) — and a conversational mismatch handler: if it becomes clear
   mid-call that the person on the line isn't `customerName`, say so
   plainly ("It looks like I'm not speaking with {name} — could you please
   hand the phone to them?") and end the call, rather than discussing
   payment details with the wrong person. This is a real-time, in-conversation
   check based only on what's said — separate from, and faster than, the
   post-call speaker-match in step 8 below, which needs the full recording
   and so can only ever confirm identity *after* the call has already ended.

6. **Vapi places the call.** `getVapiClient().calls.create({...})`
   (`lib/vapi.ts` — a lazily-constructed `VapiClient` singleton, `VAPI_API_KEY`)
   is called with:
   - `assistantId: VAPI_ASSISTANT_ID` — the one saved assistant this branch
     manages (see §8, `sync-assistant.ts`); its **persisted** config
     (pushed once via the sync script) defaults to the `onboarding_profile`
     prompt/schema, but every real call from this app overrides that inline
     (next bullet), so the persisted default only matters for a call placed
     directly against Vapi's API/dashboard bypassing this app entirely.
   - `phoneNumberId: VAPI_PHONE_NUMBER_ID` — the Vapi-owned or
     Twilio/Vonage/Telnyx-imported number to call from.
   - `customer: { number: toNumber, name: user.name }`.
   - `assistantOverrides: callOverrides({ purpose, fields, customerName, context: promptContext })`
     — the per-call model/prompt/first-message/structured-data-schema,
     layered onto the saved assistant for just this one call.
   - Model: `{ provider: CALLING_AGENT_MODEL_PROVIDER ?? "google", model: CALLING_AGENT_MODEL ?? "gemini-2.5-flash", temperature: 0.3 }`
     — any Vapi-supported provider works by changing two env vars; no code
     change. Gemini via Vertex AI/GCP service accounts is explicitly **not**
     supported today — Vapi's Google provider wants a plain AI-Studio-style
     API key.
   - Voice: ElevenLabs, `voiceId: ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"` (the
     "George" premade voice — see §4 for why), `model: "eleven_multilingual_v2"`
     (pinned, not left to Vapi's default).
   - `voicemailDetection: { provider: "vapi" }` — Vapi's own built-in
     voicemail/IVR classifier.
   - `server: { url: CALLING_AGENT_WEBHOOK_URL, headers: { "x-calling-agent-secret": CALLING_AGENT_WEBHOOK_SECRET } }`.
   - `maxDurationSeconds: 600` (10-minute cap).
   - `analysisPlan.structuredDataPlan: { enabled: true, schema: intakeSchema(fields) }`
     (§6).
   - On success: `attachVapiCall()` updates the DB row with the returned
     `vapiCallId`, `assistantId`, and initial `status`; the route responds
     `201` with the call plus that status.
   - On failure (Vapi API error/exception): `markCallFailed()` sets
     `status='failed'` with the error message; the route responds `502`.
     **No automatic retry** — retrying is a manual "call again" from the UI.

7. **Vapi runs the call**: PSTN dial-out, speech-to-text, the assistant's
   LLM turn (Gemini), ElevenLabs TTS for each response, and posts events
   back to `POST /api/calling-agent/webhook` as the call progresses —
   `status-update` messages as it goes from queued → ringing → in-progress
   → ended, and one `end-of-call-report` once it's over, carrying the full
   transcript, the recording URL, and Vapi's own structured-data extraction.

8. **The webhook handler processes each event** (`app/api/calling-agent/webhook/route.ts`,
   see §5.3 for the auth check):
   - Every event is logged verbatim to `calling_agent_events` first
     (`recordEvent()`), regardless of type, keyed by `vapi_call_id` (and
     `call_id` when a matching row is found).
   - `status-update` → `updateCallFromWebhook(vapiCallId, {status, raw})`.
   - `end-of-call-report` → first runs `detectHuman()`
     (`lib/calling-agent/human-detection.ts`), passing
     `vapiVoicemailDetected: message.endedReason === "voicemail"` (this is
     the *only* signal fed in — there's no separate structured voicemail
     field read from the payload) plus the recording URL, transcript, and
     the call's `userId` (from the DB row looked up by `vapi_call_id`).
     Then updates the row: `status: "ended"`, `endedReason`, `transcript`,
     `recordingUrl`, `structuredData: message.analysis?.structuredData`,
     and the `humanDetection` verdict — all in one `updateCallFromWebhook()`
     call.
   - Every other message type (`transcript`, `speech-update`, …) is logged
     by the `recordEvent()` step above and otherwise ignored.
   - Responds `{ok: true}` (200) even when `vapiCallId` is missing from the
     payload, specifically so Vapi doesn't retry forever on something this
     branch can never correlate.

9. **`detectHuman()`'s two questions** (full detail in §5.3's neighbor,
   `lib/calling-agent/human-detection.ts`):
   - **`isHuman`** — answered purely from Vapi's own voicemail/IVR
     classifier. `vapiVoicemailDetected === true` → `isHuman: false`,
     `source: "vapi-voicemail-detection"`, and the speaker-match is skipped
     entirely (no point checking whose voice an answering machine has).
   - **`isAccountOwner`** — the one that actually matters for
     `purchase_verification`. If there's a recording URL and a known
     `userId`:
     1. `getEnrolledEmbedding(userId)` reads `voice_enrollments.embedding`
        (owned by the `voice-verification` branch, same shared DB) and
        `decryptSecret()`s it (`lib/crypto.ts`, AES-256-GCM — `ENCRYPTION_KEY`
        must match `voice-verification`'s exactly). No enrollment row →
        `source: "no-enrollment"`, `isHuman: true`, `isAccountOwner: null`
        (a human was confirmed, just not checked against anything).
     2. Fetches the recording itself (`fetch(recordingUrl)` → `.blob()`).
     3. `verifyAudio()` (`lib/calling-agent/voice-match.ts`) POSTs the audio
        blob + the enrolled embedding (as a JSON string) as multipart form
        data to `{VOICE_SERVICE_URL}/verify` — `voice-verification`'s
        `services/voice-inference` Cloud Run service, the exact same
        ECAPA-TDNN speaker-matching model and threshold (~0.5 cosine
        similarity, per root `ARCHITECTURE.md`) that branch's own `/voice`
        page uses. Auth is defense-in-depth: a Google-signed ID token for
        the Cloud Run service's own audience (via `GoogleAuth` +
        `GCP_VOICE_CALLER_KEY_BASE64`, a base64 GCP service-account JSON)
        **plus** an app-level `X-Api-Key: VOICE_SERVICE_API_KEY` header.
     4. Result: `source: "speaker-match"`, `isHuman: true`,
        `isAccountOwner: result.match`, `speakerScore: result.score`.
     5. Any failure fetching the recording or reaching voice-inference is
        caught → `source: "speaker-match-error"`, `isAccountOwner: null`,
        `isHuman` falls back to whatever the voicemail signal already
        established (or `true` if that was itself unknown).
   - Deliberately **not** using `voice-verification`'s anti-spoofing model
     (`/spoof-check`, AASIST) here — that answers "live human vs. a
     replay/clone," a different question from identity, and Vapi's own
     voicemail detection already covers "is anyone really there."

10. **The UI polls and displays the result.** `/calling-agent`
    (`app/calling-agent/page.tsx`) calls `GET /api/calling-agent/calls`
    on load and every 4 seconds while any call is in an active status
    (`queued`/`scheduled`/`ringing`/`in-progress`/`forwarding`), stopping
    once nothing is active. Expanding a call shows its context, human
    detection, collected structured data, transcript, and an `<audio>`
    player for the recording. **See §12** — this page's own display and
    request-building code have not been kept fully in sync with the
    branch's later commits.

---

## 4. The persona and the voice: a naming history worth knowing

The task of "give the calling agent a name and voice" took five commits to
settle, and the two ended up **not matching** — worth knowing before reading
a transcript where "Hale" introduces itself in a voice ElevenLabs calls
"George."

| Commit | What changed |
|---|---|
| `e9eb70d` "Fix voice ID and give the agent a persona name" | The hardcoded default voice (`21m00Tcm4TlvDq8ikWAM`, "Rachel") isn't in every account's library and hard-fails TTS. Live-tested; switched to "Sarah" (`EXAVITQu4vr4xnSDxMaL`), confirmed present via `GET /v1/voices`. Separately, a live test call had the model say the literal words *"my name is agent name"* — told to "introduce yourself by name" with no name actually given, it filled the slot with the placeholder text. Fixed by giving the persona a fixed `AGENT_NAME` (first set to **"Alex"**) used in both the first message and the system prompt, and branching the identity-check instruction on whether `customerName` is known. |
| `10177fd` "Name the calling agent persona Hale" | Renames `AGENT_NAME` from "Alex" to **"Hale"** — message-only rename, no other behavior change. |
| `10f09dc` "Use the 'Hale' ElevenLabs voice to match the agent's persona name" | Switches `ELEVENLABS_VOICE_ID`'s default to `wWWn96OtTHu1sn8SRGEr`, an ElevenLabs Voice Library voice literally named "Hale," to match the persona name. **This is what broke TTS.** |
| `6541200` "Fix ElevenLabs TTS failure: use a premade voice, pin the TTS model" | Every call was dying ~5 seconds in with `pipeline-error-eleven-labs-voice-failed` and an empty transcript. Root cause: the "Hale" voice is a Voice Library voice, category `professional` — and on a **free ElevenLabs plan, only `premade`-category voices can be synthesized via the API**. A library voice 402s (`paid_plan_required`, *"Free users cannot use library voices via the API"*), but **Vapi never surfaces that 402** — it reports only the opaque pipeline error, indistinguishable at a glance from a bad voice id or bad key. Confirmed directly against ElevenLabs: Hale (professional) → 402; Adam (premade) → 200 with real audio. Fix: default to a premade voice (Adam, at this commit) and pin `model: "eleven_turbo_v2_5"` explicitly rather than inherit Vapi's default. Commit message: *"Verified end to end with a real outbound call: full conversation, correct flow, structured data extracted."* |
| `4816279` "Use the George voice on ElevenLabs' multilingual model" (**current `HEAD`**) | `turbo_v2_5` "sounded flat and robotic on a real call." Switches to **`eleven_multilingual_v2`** (~200–400ms slower per response, judged an acceptable tradeoff since the agent talks in short turns) and to the **"George"** premade voice, `JBFqnCBsd6RMkjVDRZzb`. Commit message: *"Synced to Vapi and verified on a live outbound call: greeting played in the new voice with no pipeline error."* |

**Net result, in the current code:** the agent introduces itself and is
addressed throughout the prompt as **"Hale"** (`AGENT_NAME` in
`lib/calling-agent/assistant.ts`, unchanged since `10177fd`) — but the actual
synthesized voice is ElevenLabs' **"George — Warm, Captivating Storyteller"**
(`DEFAULT_ELEVENLABS_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"`), because the voice
that would actually match the name "Hale" isn't usable on a free ElevenLabs
plan. The code comment on `DEFAULT_ELEVENLABS_VOICE_ID` states this
explicitly and says switching back once the plan is upgraded is "just an
`ELEVENLABS_VOICE_ID` change, no code edit" — true, though the spoken name
would then need a matching update too, or the mismatch would simply reverse.

The diagnostic curl `docs/CALLING_AGENT.md` recommends for this exact
failure mode (distinguishing plan vs. key vs. voice-id) is reproduced there
verbatim and still accurate against the current code.

---

## 5. Every API route

### 5.1 `POST /api/calling-agent/calls`

- **Auth:** `vouch_session` cookie, HS256 JWT, shared `JWT_SECRET`. Enforced
  twice: `middleware.ts` 401s before the handler runs if the cookie is
  missing/invalid; the handler's own `requireUser()` (`lib/session.ts`)
  re-verifies and 401s again defensively if reached without one.
- **Request body** (`CreateCallBody`, all optional):
  ```ts
  {
    toNumber?: string;        // E.164; defaults to user_profiles.phone_number
    purpose?: string;         // defaults to "onboarding_profile"
    fields?: IntakeField[];   // defaults to DEFAULT_INTAKE_FIELDS regardless of `purpose` — see §12
    context?: string;         // free text; also the Backboard search query when purpose is purchase_verification
  }
  ```
- **Response `201`:** `{ call: {...CallRecord, vapiCallId, status} }`
- **Response `400`:** `{ error: "toNumber is required (no phone number on file for this user either)" }`
- **Response `401`:** `{ error: "Not authenticated" }`
- **Response `502`:** `{ error: <Vapi error message> }` — call row is marked `failed` first
- **Response `500`:** `{ error: <message> }` for any other exception

### 5.2 `GET /api/calling-agent/calls`

- **Auth:** same as above.
- **Request:** none.
- **Response `200`:** `{ calls: CallRecord[] }` — `listCallsForUser(userId, limit=50)`, newest first.
- **Response `401`:** `{ error: "Not authenticated" }`

### 5.3 `GET /api/calling-agent/calls/[id]`

- **Auth:** same as above; additionally scoped — `getCallForUser(id, userId)`
  filters by `user_id` in the SQL itself, so requesting another user's call
  id returns `404`, not another user's data.
- **Request:** `id` path param (call's UUID).
- **Response `200`:** `{ call: CallRecord }`
- **Response `404`:** `{ error: "Not found" }`
- **Response `401`:** `{ error: "Not authenticated" }`

### 5.4 `POST /api/calling-agent/webhook`

- **Auth:** **not** the session cookie — `middleware.ts` explicitly exempts
  this path (`EXEMPT_PATHS`). Instead, `verifyWebhookSecret()`
  (`lib/calling-agent/webhook-auth.ts`) does a constant-time
  (`crypto.timingSafeEqual`) comparison of the `x-calling-agent-secret`
  request header against `CALLING_AGENT_WEBHOOK_SECRET`. Vapi is configured
  to send this header on every request via `server.headers` in
  `baseAssistantConfig()` — a plain custom header stands in for Vapi's old
  `server.secret` mechanism, which its current API dropped in favor of a
  `credentialId` scheme `@vapi-ai/server-sdk` doesn't yet expose. (Note:
  `middleware.ts`'s own inline comment calls this the "`x-vapi-secret`
  header" — that name is stale/wrong; the real header, defined in
  `webhook-auth.ts` and consumed here, is `x-calling-agent-secret`. See §12.)
- **Request body:** Vapi's server-message envelope, `{ message: VapiServerMessage }`,
  loosely typed here to just the fields used: `type`, `call.id`,
  `call.assistantId`, `status`, `endedReason`, `artifact.transcript`,
  `artifact.recordingUrl`, `analysis.structuredData`.
- **Response `401`:** `{ error: "Invalid webhook secret" }`
- **Response `200`:** `{ ok: true }` — including when `message.call.id` is
  absent (nothing to correlate; acked anyway so Vapi stops retrying).
- **Response `500`:** `{ error: <message> }` on a DB or processing failure.
- **Side effects:** always appends to `calling_agent_events`; on
  `end-of-call-report`, additionally runs `detectHuman()` and updates the
  `calling_agent_calls` row (see §3 step 8).

### 5.5 Supporting routes (shared shape, not calling-agent-specific)

| Route | Method | Purpose |
|---|---|---|
| `/api/auth/me` | `GET` | `{ user }` from `getCurrentUser()`, or `{ user: null }` |
| `/api/auth/logout` | `POST` | Clears the `vouch_session` cookie (same domain/path options used to set it) |
| `/api/health` | `GET` | `select now(), version()` — DB connectivity smoke test, no auth |

---

## 6. The structured output: `{confirmed, concern_reason}`

Vapi's **structured-data extraction** is an LLM pass over the finished
transcript (`analysisPlan.structuredDataPlan`), configured via
`intakeSchema(fields)` in `lib/calling-agent/assistant.ts`:

```ts
export function intakeSchema(fields: IntakeField[]): Vapi.JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map((f) => [f.key, { type: f.type, description: f.description }]),
    ),
    required: fields.map((f) => f.key),
  };
}
```

For `purchase_verification`, the field set is `PURCHASE_VERIFICATION_FIELDS`:

```ts
export const PURCHASE_VERIFICATION_FIELDS: IntakeField[] = [
  {
    key: "confirmed",
    label: "Confirmed",
    description: "true if the customer confirms they personally authorized this specific purchase, false if they say they did not.",
    type: "boolean",
  },
  {
    key: "concern_reason",
    label: "Concern reason",
    description: "If not confirmed, or the customer sounds unsure/concerned, a brief note why (e.g. 'doesn't recognize merchant', 'says card was lost'). Empty string if confirmed with no concerns.",
    type: "string",
  },
];
```

This schema is requested two ways:
- **Persisted on the saved assistant** (`baseAssistantConfig()` →
  `structuredDataPlan(DEFAULT_INTAKE_FIELDS)`) — but that's the
  *onboarding* field set, since the saved assistant's baseline purpose is
  `onboarding_profile`.
- **Per-call, via `assistantOverrides`** (`callOverrides({ fields, ... })`)
  — whatever `fields` array the caller of `POST /api/calling-agent/calls`
  supplied, defaulting to `DEFAULT_INTAKE_FIELDS` if omitted **regardless of
  `purpose`** (§12 — the built-in `/calling-agent` page doesn't actually
  send `PURCHASE_VERIFICATION_FIELDS` for its own "Purchase verification"
  preset).

**Consumption:** Vapi runs this extraction after the call ends and includes
it as `analysis.structuredData` on the `end-of-call-report` webhook message.
`app/api/calling-agent/webhook/route.ts` reads
`message.analysis?.structuredData` and writes it verbatim into
`calling_agent_calls.structured_data` (`jsonb`) via `updateCallFromWebhook()`
— no schema validation on the way in; it's whatever JSON Vapi's extraction
pass produced. `app/calling-agent/page.tsx` renders it as a plain key/value
list when a call is expanded. The branch's own docs are explicit that this
extraction is "probably right," not "definitely right," until checked
against real calls — it's an LLM pass, not a hard validator.

---

## 7. `scripts/calling-agent/`

### `sync-assistant.ts` — push the assistant config to Vapi

```sh
npm run calling-agent:sync-assistant
```

Builds `baseAssistantConfig()` and either `assistants.update()`s the
assistant at `VAPI_ASSISTANT_ID` if that env var is set, or (first run)
searches `vapi.assistants.list()` for one already named `"vouch-calling-agent"`
and updates that, or creates a new one. Always upserts by name — safe to
re-run any time `lib/calling-agent/assistant.ts` changes. First-run output
prints the new assistant id to copy into `VAPI_ASSISTANT_ID`.

### `place-test-call.ts` — ad-hoc real call, bypassing this app entirely

```sh
npm run calling-agent:test-call -- --to +14155551234 [--purpose purchase_verification] [--context "..."] [--name "..."]
```

Talks to Vapi's API **directly** — no DB row, no session, no webhook
involved (it can't be, since this script doesn't run behind a public URL).
Correctly maps `purpose` to the matching field set itself
(`purpose === PURCHASE_VERIFICATION_PURPOSE ? PURCHASE_VERIFICATION_FIELDS : DEFAULT_INTAKE_FIELDS`
— unlike the production API route, see §12), builds the same
`callOverrides()` the real route would, creates the call, then **polls**
`vapi.calls.get()` every 5 seconds (up to 90 times, i.e. ~7.5 minutes) until
a terminal status (`ended`, `not-found`, `deletion-failed`). Prints status,
ended reason, cost, transcript, structured data, and recording URL to
stdout at the end. This script — not the deployed webhook path — is almost
certainly how the "Hale"/voice fixes in §4 were actually validated, since
its console output is exactly what those commit messages describe
("full conversation, correct flow, structured data extracted").

### `migrate.mjs` (shared, not calling-agent-specific)

Applies `db/migrations/*.sql` in filename order inside a transaction each,
tracked in a `_migrations(name, applied_at)` table so re-running is a no-op
for already-applied files. No down-migrations. `npm run db:migrate`.

---

## 8. Database schema

Owner: `calling-agent`. Both tables are created by migration `0001`;
migration `0002` is a single additive column. Reproduced verbatim.

### `db/migrations/0001_calling_agent_calls.sql`

```sql
-- Calling-agent schema: outbound Vapi calls that collect/verify onboarding
-- info on Vouch's behalf. Mirrors bank-connection's pattern (see
-- docs/PLAID.md) — typed columns for what we query on, the full raw Vapi
-- payload kept in a `raw` jsonb column so nothing is thrown away as the
-- integration evolves. `user_id` is `text` (not `uuid`) to match the
-- shared `users.id` column (see the portal branch's
-- migrations/001_create_users.sql).

create extension if not exists pgcrypto;

-- One row per outbound call. Created (status='queued') before we even call
-- Vapi, so a failure to reach Vapi's API still leaves an audit trail.
create table if not exists calling_agent_calls (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users (id) on delete cascade,
  vapi_call_id text unique,
  vapi_assistant_id text,
  to_number text not null,
  purpose text not null default 'onboarding_profile',
  intake_schema jsonb not null default '[]'::jsonb,
  status text not null default 'queued',
  ended_reason text,
  human_detection jsonb,
  transcript text,
  recording_url text,
  structured_data jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists calling_agent_calls_user_id_idx on calling_agent_calls (user_id);
create index if not exists calling_agent_calls_status_idx on calling_agent_calls (status);

-- Append-only raw webhook event log, for debugging/audit (mirrors
-- bank-connection's plaid_sync_runs — "why doesn't this call show XYZ yet").
create table if not exists calling_agent_events (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references calling_agent_calls (id) on delete cascade,
  vapi_call_id text,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create index if not exists calling_agent_events_call_id_idx on calling_agent_events (call_id);
```

### `db/migrations/0002_calling_agent_calls_context.sql`

```sql
-- Free-text detail specific to one call (e.g. the actual transaction being
-- verified for a purchase_verification call) — see
-- lib/calling-agent/assistant.ts's CallOverridesOptions.context.
alter table calling_agent_calls add column if not exists context text;
```

`context` (added by `0002`) holds only the caller-supplied text, **not** the
Backboard-augmented prompt actually sent to Vapi — see §3 step 3.

`calling_agent_calls.user_id references users(id)` — a hard FK to the
`portal` branch's shared `users` table, `on delete cascade`. `intake_schema`
stores whatever `fields` array the call was created with (the *shape* of
what's being collected); `structured_data` stores what actually came back.

---

## 9. Environment variables

Grepped across every `.ts`/`.tsx`/`.mjs` file on the branch (both direct
`process.env.NAME` access and the `requiredEnv("NAME")` helper's bracket
lookups), cross-referenced against `.env.example`.

| Variable | Purpose | Where used |
|---|---|---|
| `DATABASE_URL` | Shared Postgres connection string | `lib/db.ts`, `scripts/migrate.mjs` |
| `JWT_SECRET` | Verifies `vouch_session` JWTs; **must equal** the portal branch's value | `lib/session-token.ts` |
| `SESSION_COOKIE_DOMAIN` | Cookie domain (`.getvouch.club`) so every subdomain sees the cookie | `lib/session-token.ts` |
| `PORTAL_LOGIN_URL` | Server-side redirect target for signed-out visitors | `middleware.ts` |
| `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Same URL, inlined client-side (post-logout redirect) | `app/calling-agent/page.tsx` |
| `VAPI_API_KEY` | Vapi private API key | `lib/vapi.ts`, both `scripts/calling-agent/*.ts` |
| `VAPI_ASSISTANT_ID` | Saved Vapi assistant id to call with / update | `app/api/calling-agent/calls/route.ts`, both scripts |
| `VAPI_PHONE_NUMBER_ID` | Vapi phone number id to place calls from | `app/api/calling-agent/calls/route.ts`, `place-test-call.ts` |
| `CALLING_AGENT_WEBHOOK_URL` | This deployment's real URL for Vapi to POST events to | `lib/calling-agent/assistant.ts` (`serverConfig()`) |
| `CALLING_AGENT_WEBHOOK_SECRET` | Shared secret Vapi echoes back on `x-calling-agent-secret` | `lib/calling-agent/assistant.ts`, `lib/calling-agent/webhook-auth.ts` |
| `ELEVENLABS_VOICE_ID` | ElevenLabs voice id — **must be `premade` category** on a free plan (§4) | `lib/calling-agent/assistant.ts` (`voiceConfig()`) |
| `CALLING_AGENT_MODEL_PROVIDER` | Vapi model provider for reasoning (default `"google"`) | `lib/calling-agent/assistant.ts` (`modelConfig()`) |
| `CALLING_AGENT_MODEL` | Model id (default `"gemini-2.5-flash"`) | `lib/calling-agent/assistant.ts` (`modelConfig()`) |
| `ENCRYPTION_KEY` | AES-256-GCM key to decrypt `voice_enrollments.embedding`; **must equal** `voice-verification`'s value | `lib/crypto.ts` |
| `VOICE_SERVICE_URL` | Base URL of the `voice-inference` Cloud Run service | `lib/calling-agent/voice-match.ts` |
| `VOICE_SERVICE_API_KEY` | App-level API key for that service (defense in depth alongside the ID token) | `lib/calling-agent/voice-match.ts` |
| `GCP_VOICE_CALLER_KEY_BASE64` | Base64-encoded GCP service-account JSON, used to mint a Cloud Run IAM ID token | `lib/calling-agent/voice-match.ts` |
| `BACKBOARD_API_KEY` | Backboard.io API key for the memory-search read path | `lib/calling-agent/backboard-context.ts` — **not listed in `.env.example`**, see §12 |
| `NODE_ENV` | Standard Next.js var; gates the cookie's `secure` flag | `lib/session-token.ts` |

Every one of these except `BACKBOARD_API_KEY` is documented in
`.env.example` (with a comment explaining what it is and, for the
cross-branch ones, that the value must match the other branch's exactly).

---

## 10. Verifying the "confirmed: true" claim

Root `ARCHITECTURE.md` §5 states: *"Verified working end to end — a real
call was placed, held a natural conversation, and returned
`{"confirmed": true}`."*

**What's actually in the repo to back that up:**

- **No committed artifact.** There is no saved transcript file, call-id
  record, recording link, log dump, or test fixture anywhere in the tree —
  the known file list is exhaustive (verified via `git ls-tree`) and
  contains no such file. `place-test-call.ts` (§8) is clearly the tool that
  *would* produce exactly this kind of output (it prints status, transcript,
  structured data, and recording URL to stdout), but nothing it printed was
  captured back into the repo.
- **Corroborating language in commit messages**, not a data artifact:
  - `6541200` ("Fix ElevenLabs TTS failure…"): *"Verified end to end with a
    real outbound call: full conversation, correct flow, structured data
    extracted."*
  - `4816279` ("Use the George voice…", current `HEAD`): *"Synced to Vapi
    and verified on a live outbound call: greeting played in the new voice
    with no pipeline error, and the webhook config survived the assistant
    update."*
  - `e9eb70d`: *"Live-tested against a real ElevenLabs account"* /
    *"A follow-up test call (voice now working) had the model say…"*
  - None of these commit messages include the literal string
    `{"confirmed": true}` or a call id — the ARCHITECTURE.md sentence is a
    paraphrase/summary of this history, not a quote of a specific logged
    result.

**Conclusion:** the claim is consistent with the branch's own commit
history — there's a real, narrated pattern of the author placing live test
calls after each fix and reporting success in the commit message — but it
is an **assertion, not evidence you can independently check from this
repo**. Confirming the literal `{"confirmed": true}` result would require
either the shared Postgres DB's live `calling_agent_calls.structured_data`
rows, or the Vapi dashboard's own call log — neither of which this
documentation task has access to.

---

## 11. Multi-tenancy & security summary

- **Session:** `vouch_session` cookie, HS256 JWT, `{userId, email}`,
  30-day TTL (`SESSION_TTL_SECONDS` in `lib/session-token.ts`), shared
  `JWT_SECRET`, domain `.getvouch.club`. This branch never issues one
  (`createSessionToken()` exists but is explicitly commented "for local
  testing only — the portal is the real issuer in production").
- **`middleware.ts`** protects `/calling-agent/:path*` and
  `/api/calling-agent/:path*` (its `matcher`), exempting only
  `/api/calling-agent/webhook`. Unauthenticated page requests redirect to
  `PORTAL_LOGIN_URL` (with `?next=`); unauthenticated API requests get a
  `401` JSON body directly from the middleware, before the route handler
  ever runs.
- **Webhook auth** is a distinct shared-secret header check
  (`x-calling-agent-secret`, constant-time compared) — see §5.4 for the
  stale-comment note.
- **No rate limiting** on `POST /api/calling-agent/calls` — any
  authenticated user can place a call, which costs real per-minute money
  across Vapi + telephony + ElevenLabs + the LLM. The branch's own docs
  flag this as a known gap needing a per-user daily cap before real users.
- **Cross-branch secrets that must match exactly:** `JWT_SECRET` (portal),
  `ENCRYPTION_KEY` (voice-verification), and implicitly `SESSION_COOKIE_DOMAIN`
  / `PORTAL_LOGIN_URL` (portal, by convention rather than a hard equality
  requirement).

---

## 12. Discrepancies and gaps found while documenting

Concrete, code-verified findings beyond what the branch's own docs say:

1. **The built-in `/calling-agent` page's "Purchase verification" preset
   requests the wrong structured-data schema.** `POST /api/calling-agent/calls`
   computes `fields = body.fields?.length ? body.fields : DEFAULT_INTAKE_FIELDS`
   — it does **not** derive `fields` from `purpose`. `app/calling-agent/page.tsx`'s
   `onSubmit` only ever sends `{ toNumber, purpose, context }` — it never
   sends `fields`. So placing a "Purchase verification" call from this
   branch's own UI runs the correct `purchase_verification` *conversation*
   (the prompt logic does branch on `purpose`), but asks Vapi's
   structured-data extraction for the **onboarding** field set (`age`,
   `phone_number`, `address_*`, …) instead of `{confirmed, concern_reason}`
   — meaning a call placed this way would never actually populate the
   verdict the whole feature exists to produce. `scripts/calling-agent/place-test-call.ts`
   gets this right (it explicitly maps `purpose` → the matching field
   constant, §8); it's not clear from this branch alone whether the
   `dashboard` branch's proxy route passes `fields: PURCHASE_VERIFICATION_FIELDS`
   explicitly — that would need to be checked in `dashboard`'s own code to
   confirm the "Call me" button avoids this gap. Not mentioned in
   `docs/CALLING_AGENT.md`'s own "Known gaps" section.

2. **The agent's spoken name and its ElevenLabs voice no longer match.**
   Fully explained in §4 — `AGENT_NAME = "Hale"` but
   `DEFAULT_ELEVENLABS_VOICE_ID` resolves to ElevenLabs' "George" voice, a
   side effect of the free-tier `premade`-vs-`professional` constraint.
   Cosmetic, not a functional bug, but worth knowing before it causes
   confusion in a transcript review.

3. **`middleware.ts`'s inline comment names the wrong webhook header.** It
   says Vapi "authenticates itself via the `x-vapi-secret` header" — the
   real header, defined in `lib/calling-agent/webhook-auth.ts` and actually
   checked by the webhook route, is `x-calling-agent-secret`
   (`WEBHOOK_SECRET_HEADER`). The behavior is correct; only the comment is
   stale.

4. **`BACKBOARD_API_KEY` is required in code but absent from `.env.example`.**
   `lib/calling-agent/backboard-context.ts` reads it (and fails soft — a
   missing key is caught the same as any other Backboard error, so this
   never breaks a call) but `.env.example` doesn't list it at all, unlike
   every other env var this branch depends on. `docs/CALLING_AGENT.md`
   does mention it in prose ("Needs `BACKBOARD_API_KEY` — already set
   project-wide on Vercel Preview from `gmail-connector`'s own setup"), so
   the omission is specifically from the `.env.example` file, not from
   documentation generally.

5. **The `/calling-agent` page's own TypeScript type for human detection is
   stale relative to `detectHuman()`'s real return shape.** The page
   declares
   `humanDetection: { isHuman: boolean | null; confidence: number | null; source: string; reason?: string } | null`
   and only ever renders `isHuman` and `source` in the UI. The actual
   `HumanDetectionResult` (`lib/calling-agent/human-detection.ts`) is
   `{ isHuman, isAccountOwner, speakerScore, source, reason }` — there is no
   `confidence` field (the real numeric field is `speakerScore`), and
   **`isAccountOwner` — the speaker-match verdict that is, per this
   branch's own docs, "the one that actually matters for
   `purchase_verification` calls" — is never displayed in the UI at all.**
   The page still only distinguishes "likely a live person" vs. "likely
   voicemail," which reads as pre-dating commit `75cec9a` ("Wire real
   speaker-matching into detectHuman()…") and never having been updated
   afterward.

6. **No automated tests exist on this branch**, despite root
   `ARCHITECTURE.md` noting Vitest is used "on the branches that have logic
   worth testing." Given the conversation-flow branching, structured-data
   schema selection, and the human-detection state machine documented
   above, this branch has non-trivial logic with no regression coverage
   beyond manual test calls.

None of the above are severe — the core pipeline (place call → webhook →
speaker-match → stored verdict) is real, wired, and (per commit-message
narration) has been exercised against live Vapi/ElevenLabs accounts — but
items 1 and 5 in particular mean the *`purchase_verification` result* is
better trusted when produced via `place-test-call.ts` or a caller (like
`dashboard`) that explicitly passes the right `fields`, than via this
branch's own built-in UI as shipped today.
