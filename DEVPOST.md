# Devpost submission copy

Paste each block into the matching field. Nothing here is invented; every
number and behaviour is in the repo.

---

## Inspiration

Cancelling a subscription is hard on purpose. The signup is one click and the
cancel is four screens, a retention offer, and sometimes a phone call during
business hours. Every company building in this space has tried to fix that by
being a better middleman: reminders, dashboards, a button that emails the
merchant on your behalf. You still end up asking permission from the company
that does not want to let you go.

We wanted the opposite. Don't negotiate with the merchant. Make the card stop
existing.

## What it does

Vouch issues a fresh single-use virtual card for every subscription payment.
The moment one transaction posts, a Stripe webhook cancels that card. The next
renewal attempt is declined at the network, before it ever reaches a retention
flow.

Around that sits the part that decides what to pay for. Connect Gmail and Vouch
pulls your receipts and renewal notices, embeds them, classifies them into
spending categories, and writes them to two memory stores at once: pgvector
tables in Postgres and a per-user Backboard assistant. The dashboard builds
your subscription list out of that, plus real Plaid balances and real issued
cards.

When it isn't sure about a charge, it calls you. An outbound voice agent on
Vapi, speaking through ElevenLabs with Gemini reasoning, greets you by time of
day, summarises what you paid this month, pulls your past payment history out
of Backboard, and asks whether you want the renewal. Here is a real transcript
from a real call to a real phone:

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

Then there is the question of who was on the phone. A voiceprint match proves
the caller is the same person who enrolled, which is not the same as proving
who that is. Anyone can sign up and enroll their own voice. So Persona runs
government ID and selfie liveness, and the resulting inquiry is stored against
the voice enrollment. After that, every speaker match inherits a government ID
check. Two biometrics, face and voice, anchored to one verified identity.

Last piece: the card lifecycle is an MCP server. Claude can mint, freeze and
cancel your cards, and it never sees a card number.

## How we built it

One repo, one Postgres, one session cookie, eight deployed services. Each
service is a long-lived git branch with its own subdomain, bound through
Vercel's Git Branch Domains. Pushing to `calling-agent` deploys
callingagent.getvouch.club. There is no service mesh and no second Vercel
project, but gmail, bank, cards, voice, identity, calling and dashboard are all
independently deployed and independently reachable.

Every branch verifies the same `JWT_SECRET`, so the session cookie the portal
issues on `.getvouch.club` is valid everywhere. Cross-service calls forward the
cookie server-side, which is how the dashboard's "Call me" button reaches the
calling agent without any CORS or a second auth system.

Speaker verification is a FastAPI service on Cloud Run running ECAPA-TDNN for
embeddings and AASIST for anti-spoofing. Enrolled voiceprints are stored
AES-256-GCM encrypted. The renew, hold and ask decision on the dashboard is
rule-based rather than a model call, deliberately, so the reason shown to you
is the reason actually used.

## Challenges we ran into

Every call died five seconds in with `pipeline-error-eleven-labs-voice-failed`
and an empty transcript. The voice id was correct, it was on the account, and
`GET /v1/voices` listed it. Two days of assuming our config was wrong. The
actual cause: the voice came from the ElevenLabs Voice Library, and a free plan
returns HTTP 402 for library voices, which Vapi collapses into that one opaque
pipeline error. We found it by calling ElevenLabs directly and watching a 402
come back for the broken voice and a 200 for a premade one.

Backboard throws a 500 on any non-integer float in metadata, so `0.528` had to
become `"0.528"`. It also caps memory content at 4096 UTF-8 *bytes*, not
characters, so one smart quote in an email body shifts where the limit lands.
Both were found by bisection.

Vercel's "Secret" environment variables are write-only. Once set, nobody can
read them back, including the person who set them. That quietly makes it
impossible to pull `DATABASE_URL` locally to run a migration, so migrations go
through a Cloud SQL import from a GCS bucket instead.

Persona's `completed` status does not mean verified. It means the user reached
the final screen. Only `approved` means the checks actually passed. Gating on
the wrong one would have let through anyone who walked to the end of the flow
with a bad document, and it would have looked like it was working.

And the embarrassing one: the entire card-issuing UI was written in Tailwind
classes on a branch where Tailwind was never installed. No dependency, no
PostCSS config, no import. It rendered as raw unstyled HTML for most of the
build and none of us noticed, because we were always testing it through the API.

## Accomplishments that we're proud of

The phone call is real. It dials a real number over PSTN, holds a conversation,
and pulls structured data out of the transcript without anyone writing a parser.

The dashboard does not fabricate anything. Nothing in our stack measures how
many hours you watched Netflix, so the real dashboard leaves those fields empty
instead of inventing a plausible number. The seeded `/demo` route shows them,
and it is clearly labelled as seeded. That distinction cost us a nicer-looking
screenshot and we kept it anyway.

And the identity design. Verification is not a signup toll here. Nobody is asked
for ID to look around; you're asked at the moment the agent is about to spend
your money, where the reason is obvious. One ID check then upgrades every future
phone call, forever, because the voiceprint is bound to it.

## What we learned

Vendor errors lie by omission. ElevenLabs knew exactly what was wrong and said
402 `paid_plan_required`. By the time it reached us through Vapi it was a
generic pipeline failure. The lesson we keep relearning is to call the
underlying API directly before believing the wrapper.

Also: read the status enum. Persona's docs say plainly not to gate on
`completed`, and it would have been very easy to ship that and never find out.

## What's next for Vouch

Live in-call identity verification. Vapi exposes `listenUrl`, a WebSocket that
streams raw PCM during the call, and `controlUrl`, which can make the assistant
speak mid-call. Today the speaker match runs after the call ends, on the
recording, which is too late to act on. Streaming that audio into the existing
ECAPA service would let the agent stop mid-sentence and say "I don't think I'm
speaking with Krishna, could you hand them the phone?" while the call is still
live. The blocker is that a Vercel function can't hold a WebSocket open for ten
minutes, so it needs a small always-on listener next to the voice service.

The Stripe Issuing Financial Account is also still stuck in `pending`, which
blocks real card creation. The code path is written and unchanged. We are
waiting on Stripe.

## Built With

next.js, typescript, postgresql, pgvector, google-cloud-sql, vercel, stripe,
stripe-issuing, plaid, gmail-api, backboard, vapi, elevenlabs, google-gemini,
persona, model-context-protocol, anthropic-claude, speechbrain, ecapa-tdnn,
aasist, fastapi, google-cloud-run, tailwindcss, vitest, playwright
