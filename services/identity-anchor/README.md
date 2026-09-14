# identity-anchor — proof of personhood, as a capability unlock

`identity.getvouch.club` · [full docs](docs/IDENTITY.md)

Government ID and selfie liveness via [Persona](https://withpersona.com), used
to decide what Vouch's agent is allowed to do on someone's behalf.

**23 tests**, all on the logic that decides whether a person is verified.

## The problem this branch actually solves

Before this, everything the agent acted on was **self-attested**. The cardholder
name Stripe received came from a signup form. The number the agent calls to
confirm a charge came from a form field. Two consequences, one of them a real
hole:

Anyone who got into an account could change the phone number and then authorize
every charge by answering their own phone. Enrolling their own voice defeats the
speaker-match too, because a voiceprint proves *consistency* — the caller
matches whoever enrolled — not *identity*.

## The idea worth stealing

**Verification is not a signup toll. It's what unlocks the agent's authority to
spend.**

Nobody is asked for ID to look around. The chain stays login → Gmail → bank →
voice → dashboard, and anyone who just wants to browse gets there exactly as
fast as before. The ask lands at **first card mint**, where the agent is about
to spend money and the reason is self-evident.

`agentTier()` is the whole rule:

| Tier | Requires | The agent may |
|---|---|---|
| `observe` | nothing | read Gmail, surface subscriptions, render the dashboard |
| `act` | inquiry status `approved` | mint cards, place calls |

It's also cheaper. Persona bills per verification, so verifying everyone at
signup costs more *and* converts worse. The economics and the good UX point the
same way, which is usually a sign the design is right.

**And one ID check upgrades every future phone call.** On approval the webhook
writes the inquiry id onto the user's `voice_enrollments.persona_inquiry_id`.
From then on every speaker-match inherits a government-ID check — one
verification, billed once, turning unlimited later calls from "same voice as
enrollment" into "the identified account holder". Two biometrics, face and
voice, anchored to one verified identity and used at different moments.

## Work worth reading

**`approved` is verified. `completed` is not.** `completed` is set when the user
reaches the final screen — it says nothing about whether the checks passed.
Gating on it would admit anyone who walked to the end of the flow with a bad
document, *and it would look like it was working*. `isVerified()` accepts one
status, and a test asserts the trap explicitly.

**The schema stores as little as it can get away with.** Persona returns full
birthdate, document number, issue and expiry dates, nationality, sex, and
photograph URLs. None of it is stored. `identity_verifications` keeps what
Stripe Issuing needs for a cardholder, plus derived booleans — most notably
`is_over_18` rather than the birthdate, because the age check is the only thing
the DOB is *for*, so `computeIsOver18()` does the comparison once and the input
is discarded. A breach of this table leaks no document numbers, no dates of
birth, and no ID images. Persona stays the system of record; `inquiry_id` is the
pointer back.

**The webhook is the source of truth, and it fails closed.** The widget's
`onComplete` and the hosted flow's redirect params are both client-controlled,
so they only ever drive UI. Status is written from the signed webhook, which:
reads the **raw body** before parsing (the HMAC is over exact bytes;
`JSON.stringify(JSON.parse(body))` reorders keys and never matches), accepts
**either** signature during a secret rotation (Persona sends two space-separated
pairs, and checking only the first silently drops every webhook for the whole
rotation window), and **500s rather than trusting an unsigned event** when no
secret is configured — an accepted unsigned webhook would let anyone who finds
the URL mark themselves verified.

`GET /api/identity/status` reconciles against Persona's API for any non-terminal
status, so a delayed or dropped event doesn't strand a user staring at a spinner.

## Tests

`lib/persona-schema.ts` is pure — no `pg`, no `fetch`, no env — so all 23 tests
run without a database or a Persona account. They cover the status trap, the
18th-birthday boundary, the `null` age for an unparseable date (defaulting
either way is harmful: `false` locks out a real user, `true` defeats the check),
a tampered body, a wrong-length signature that would otherwise throw inside
`timingSafeEqual`, and an assertion that the birthdate and document number never
appear in the parsed output.

## Stack

Next.js 15 · TypeScript · PostgreSQL · Persona · Vitest

See [`docs/IDENTITY.md`](docs/IDENTITY.md) for setup, the voice binding, and how
to exercise every path in sandbox with `perform-simulate-actions`.
