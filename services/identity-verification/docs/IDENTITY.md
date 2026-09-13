# Identity verification (Persona)

This branch (`identity-verification`, deployed to `identity.getvouch.club`)
proves there is a real, identified human behind an account before Vouch's
agent is allowed to spend money on their behalf. It uses
[Persona](https://withpersona.com) for government ID, selfie liveness, and
phone verification.

## Why it exists

Vouch mints real virtual cards (`card-issuing`) and places real phone calls
that authorize charges (`calling-agent`). Before this branch, everything
those decisions rested on was **self-attested**: the cardholder name came
from whatever was typed at signup, and the number the agent calls to confirm
a charge came from a form field. Two consequences:

1. Stripe Issuing received unverified cardholder identity.
2. Anyone who got into an account could change the phone number and then
   authorize every charge by answering their own phone. Enrolling their own
   voice defeats the speaker-match too, since that only proves the caller is
   the same person who enrolled — not who that person is.

Persona replaces self-attestation at both points.

## Where it sits in onboarding: nowhere

Deliberately **not** a fifth onboarding step. The chain stays
login → Gmail → bank (skippable) → voice → dashboard, and anyone who just
wants to look around reaches the dashboard exactly as fast as before.

Verification is instead triggered at **first card mint** — the moment the
agent is about to spend money, where the user already expects a pause
because they are creating a payment card. The reason for the ask is then
concrete and immediate, which is what stops it feeling like a toll booth.
It's also cheaper: Persona bills per verification, so verifying everyone at
signup costs more *and* converts worse.

### Tiers

`agentTier()` in `lib/persona-schema.ts` is the whole rule:

| Tier | Requires | The agent may |
|---|---|---|
| `observe` | nothing | read Gmail, surface subscriptions, render the dashboard |
| `act` | inquiry status `approved` | mint cards, place calls |

## The voice binding

This is the part that makes the integration worth more than a checkbox.

`voice_enrollments` (owned by `voice-verification`) proves *consistency* —
the voice on a call matches the voice that enrolled. It proves nothing about
*identity*, because anyone can sign up and enroll their own voice.

On approval, the webhook writes the inquiry id onto the user's
`voice_enrollments.persona_inquiry_id`. From that point every later
speaker-match inherits a government-ID check, which is what lets the calling
agent treat "the voice matched" as authorization to spend. One ID
verification, paid for once, upgrades an unlimited number of future phone
confirmations.

Two independent biometrics — Persona's face, our voice — anchored to one
verified identity and used at different moments.

## Data minimization

Persona returns full birthdate, document number, issue/expiry dates,
nationality, sex, and photograph URLs. **None of that is stored.**
`identity_verifications` keeps only what Stripe Issuing needs to create a
cardholder (legal name + address) plus derived booleans.

The birthdate is the clearest case: the only thing we need it for is the
18+ check Stripe requires, so `computeIsOver18()` does the comparison once
and only the boolean is persisted. Persona stays the system of record, and
`inquiry_id` is the pointer back if a dispute ever needs the full record. A
breach of our database leaks no document numbers, no dates of birth, and no
ID images.

## Correctness details that are easy to get wrong

- **`approved` means verified. `completed` does not.** `completed` is set
  when the user reaches the final screen — it says nothing about whether the
  checks passed, so gating on it would admit anyone who walked to the end of
  the flow with a bad document. Persona's own docs are explicit about this.
  Enforced in `isVerified()` and covered by tests.
- **The webhook is the source of truth.** The widget's `onComplete` and the
  hosted flow's redirect params are both client-side and attacker
  controllable; they only ever drive UI. Status is written from the signed
  webhook, and `GET /api/identity/status` reconciles against Persona's API
  for any non-terminal status in case an event was delayed or dropped.
- **The webhook reads the raw body before parsing.** The HMAC is computed
  over the exact bytes sent; `JSON.stringify(JSON.parse(body))` reorders keys
  and the signature will never match.
- **Both signature pairs are accepted.** During a secret rotation Persona
  sends two space-separated `t=…,v1=…` pairs. Checking only the first
  silently drops webhooks for the entire rotation window.
- **It fails closed.** No `PERSONA_WEBHOOK_SECRET` means the webhook route
  500s rather than trusting unsigned events — an accepted unsigned webhook
  would let anyone who finds the URL mark themselves verified.
- **Persona being down degrades, it doesn't break.** An outage drops the
  agent to `observe`; it never 500s the dashboard.

## Setup

1. Create a Persona account and stay in the **Sandbox** environment.
2. Dashboard → API → API Keys → copy the `persona_sandbox_…` key into
   `PERSONA_API_KEY`.
3. Dashboard → Inquiries → Templates → copy the `itmpl_…` id into
   `PERSONA_TEMPLATE_ID`. The template should include Government ID, Selfie,
   and Phone Number verifications.
4. Copy the `env_…` environment id into `NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID`.
5. Dashboard → Webhooks → add
   `https://identity.getvouch.club/api/identity/webhook`, subscribe to the
   `inquiry.*` events, and copy the secret into `PERSONA_WEBHOOK_SECRET`.
6. Add a Workflow triggered on `inquiry.completed` that approves the
   inquiry — without one, nothing ever reaches `approved` and no user is
   ever verified.
7. Apply `db/migrations/0001_identity_verifications.sql`.
8. `npm test` to check the schema logic; `npm run build` to check the app.

### Testing every path without a real ID

Sandbox has a simulate-actions endpoint that fires the real webhooks, so the
whole pipeline can be exercised end to end:

```sh
curl -X POST \
  "https://api.withpersona.com/api/v1/inquiries/<inq_...>/perform-simulate-actions" \
  -H "Authorization: Bearer $PERSONA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"meta":{"simulate-actions":[{"type":"approve_inquiry"}]}}'
```

Inquiry actions: `start_inquiry`, `complete_inquiry`, `fail_inquiry`,
`expire_inquiry`, `mark_for_review_inquiry`, `approve_inquiry`,
`decline_inquiry` — one per path the UI handles.

## Multi-tenancy

Same contract as every other branch: the portal issues the `vouch_session`
cookie on `.getvouch.club`, this branch verifies it with the shared
`JWT_SECRET` and never issues one. `middleware.ts` gates `/verify` and
`/api/identity/*`, with `/api/identity/webhook` explicitly exempted — Persona
carries no session cookie and authenticates by signature instead.

## Still to do

- Feed the verified name/address into `card-issuing`'s `ensureCardholder()`
  so Stripe receives verified KYC rather than self-reported data.
- Gate the mint action on `agentTier() === "act"`.
- Step-up re-verification when a call's speaker-match returns
  `isAccountOwner: false`: issue a one-time Persona link and hold the
  renewal until it clears, rather than simply refusing.
- Account recovery via `selfie_account_comparison` against the Persona
  Account's existing faces.
