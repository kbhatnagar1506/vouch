# Devpost submission copy

Paste each block into the matching field. Nothing here is invented; every
number and behaviour is in the repo.

---

## Inspiration

Have you ever paid for a subscription and forgot about it?

We're founders. Between the three of us we are paying for tools we signed up
for during a sprint eighteen months ago and never opened again. The signup was
one click. The cancel is four screens, a retention offer, and sometimes a phone
call during business hours. That asymmetry is not an accident, and every product
that tries to fix it by being a polite middleman still ends up asking permission
from the company that does not want to let you go.

Then AI agents started being able to buy things, and the same problem got
sharper. If you hand an agent your card, you have handed it your card. Not a
budget, not a scope, not an expiry. Your actual sixteen digits, for every
merchant, forever.

Both problems have the same answer. Stop protecting the checkout. Make the card
disposable.

## What it does

Vouch gives AI agents temporary cards, so recurring payments and agent payments
both stop being open-ended.

Say your agent needs to book an Uber from Atlanta to Houston and grab Uber One
along with it, somewhere between $20 and $30. Instead of holding your real card,
the agent asks Vouch over MCP. Vouch mints a virtual card scoped to that
purchase with a $30 spending limit enforced by Stripe, hands it over, and the
card cancels itself the moment its first transaction posts. The agent spends it
once. Nothing it does afterwards can touch that number again, and your real card
was never in the conversation.

The same mechanism kills the subscription problem. Every renewal gets its own
single-use card, so the next charge attempt is declined at the network before it
reaches a retention flow. You don't cancel the subscription. The card stops
existing.

Around that sits the part that decides what to pay for. Connect Gmail and Vouch
pulls your receipts and renewal notices, embeds them, classifies them into
spending categories, and writes them to two memory stores at once: pgvector
tables in Postgres and a per-user Backboard assistant. The dashboard builds your
subscription list from that, plus real Plaid balances and real issued cards.

When it isn't sure, it calls you. An outbound voice agent on Vapi, speaking
through ElevenLabs with Gemini reasoning, rings your phone. Here is a real
transcript from a real call:

> **Hale:** Good morning, Krishna. This is Hale calling from Vouch, to quickly
> go over a recent purchase on your account. How are you doing today?
> **Krishna:** I'm doing pretty good.
> **Hale:** That's great to hear.
> **Krishna:** How are you doing?
> **Hale:** I'm doing great, thanks for asking. So this month on your account,
> we have a Netflix charge for $15.49 on the 3rd, Spotify for $11.99 on the
> 1st, and ChatGPT Plus for $20.00 on the 9th, making it $47.48 total.
> **Hale:** I'm calling because your Spotify renews in 2 days, on the card
> ending 4021. Did you want to go ahead with that?

It extracted `{"confirmed": true}` from that conversation on its own.

Then there's who was actually on the phone. A voiceprint match proves the caller
is whoever enrolled, which is not the same as proving who that is. Anyone can
sign up and enroll their own voice. So Persona runs government ID and selfie
liveness, and the resulting inquiry is stored against the voice enrollment.
After that, every speaker match inherits a government ID check. Face and voice,
anchored to one verified identity.

## How we built it

One repo, one Postgres, one session cookie, eight deployed services. Each
service is a long-lived git branch with its own subdomain, bound through
Vercel's Git Branch Domains, so pushing to `calling-agent` deploys
callingagent.getvouch.club. No service mesh and no second Vercel project, but
gmail, bank, cards, voice, identity, calling and dashboard are each
independently deployed and independently reachable.

Every branch verifies the same `JWT_SECRET`, so the session cookie the portal
issues on `.getvouch.club` is valid everywhere. Cross-service calls forward it
server-side, which is how the dashboard's "Call me" button reaches the calling
agent with no CORS and no second auth system.

The agent-facing surface is an MCP server over Streamable HTTP with eight tools.
MCP clients aren't browsers and can't carry a session cookie, so it authenticates
with its own revocable bearer keys, SHA-256 hashed and shown once at creation.
No tool ever returns a card number for a Stripe-issued card. The PAN stays out
of our server entirely and is revealed client-side through a short-lived
ephemeral key, and `simulate_purchase` drives a real test-mode authorization
against the card's own `spending_controls` so Stripe decides approve or decline,
not our code.

Speaker verification is a FastAPI service on Cloud Run running ECAPA-TDNN for
embeddings and AASIST for anti-spoofing, with enrolled voiceprints stored
AES-256-GCM encrypted. The renew, hold and ask decision on the dashboard is
rule-based rather than a model call, deliberately, so the reason we show you is
the reason we used.

## Challenges we ran into

Every call died five seconds in with `pipeline-error-eleven-labs-voice-failed`
and an empty transcript. The voice id was correct, it was on the account, and
`GET /v1/voices` listed it. We spent two days assuming our config was wrong. The
real cause: the voice came from the ElevenLabs Voice Library, and a free plan
returns HTTP 402 for library voices, which Vapi collapses into that one opaque
pipeline error. We found it by calling ElevenLabs directly and watching a 402
come back for the broken voice and a 200 for a premade one.

Backboard throws a 500 on any non-integer float in metadata, so `0.528` had to
become `"0.528"`. It also caps memory content at 4096 UTF-8 *bytes*, not
characters, so one smart quote in an email body moves where the limit lands.
Both found by bisection.

Vercel's "Secret" environment variables are write-only. Once set, nobody can
read them back, including the person who set them, which quietly makes it
impossible to pull `DATABASE_URL` locally to run a migration. Migrations go
through a Cloud SQL import from a GCS bucket instead.

Persona's `completed` status does not mean verified. It means the user reached
the final screen. Only `approved` means the checks passed. Gating on the wrong
one would have admitted anyone who walked to the end of the flow with a bad
document, and it would have looked like it was working.

And the embarrassing one. The entire card-issuing UI was written in Tailwind
classes on a branch where Tailwind was never installed. No dependency, no
PostCSS config, no import. It rendered as raw unstyled HTML for most of the
build and we didn't notice, because we were always testing that service through
its API.

## Accomplishments that we're proud of

The phone call is real. It dials a real number over PSTN, holds a conversation,
and pulls structured data out of the transcript without anyone writing a parser.

An agent can hold a card that cannot hurt you. Scoped to an amount, dead after
one charge, revocable from a panel, and it never sees your real number.

The dashboard doesn't fabricate anything. Nothing in our stack measures how many
hours you watched Netflix, so the real dashboard leaves those fields empty
instead of inventing a plausible number. The seeded `/demo` route shows them and
says so. That cost us a nicer screenshot and we kept it anyway.

## What we learned

Vendor errors lie by omission. ElevenLabs knew exactly what was wrong and said
402 `paid_plan_required`. By the time it reached us through Vapi it was a
generic pipeline failure. Call the underlying API directly before believing the
wrapper.

Read the status enum. Persona's docs say plainly not to gate on `completed`, and
it would have been very easy to ship that and never find out.

## What's next for Vouch

Live in-call identity verification. Vapi exposes `listenUrl`, a WebSocket that
streams raw PCM during the call, and `controlUrl`, which can make the assistant
speak mid-call. Today the speaker match runs after the call ends, on the
recording, which is too late to act on. Streaming that audio into the ECAPA
service we already run would let the agent stop mid-sentence and say "I don't
think I'm speaking with Krishna, could you hand them the phone?" while the call
is still live. The blocker is that a Vercel function can't hold a WebSocket open
for ten minutes, so it needs a small always-on listener beside the voice service.

Merchant-locked cards are the other one. Stripe's `spending_controls` can
restrict a card to a merchant category, so the Uber card could be rejected
everywhere that isn't rideshare.

The Stripe Issuing Financial Account is also still stuck in `pending`, which
blocks real card creation. The code path is written and unchanged. We're waiting
on Stripe.

## Built With

next.js, typescript, postgresql, pgvector, google-cloud-sql, vercel, stripe,
stripe-issuing, plaid, gmail-api, backboard, vapi, elevenlabs, google-gemini,
persona, model-context-protocol, anthropic-claude, speechbrain, ecapa-tdnn,
aasist, fastapi, google-cloud-run, tailwindcss, vitest, playwright
