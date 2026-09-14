# calling-agent — an outbound voice agent that knows who it's talking to

`callingagent.getvouch.club` · [full docs](docs/CALLING_AGENT.md)

Places real PSTN calls to confirm a charge before money moves. Vapi for call
orchestration and telephony, ElevenLabs for the voice, Gemini for reasoning,
and this branch's own speaker-verification check for identity.

A real call, unedited:

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

It extracted `{"confirmed": true}` from that conversation on its own, via an
`analysisPlan` JSON schema — no transcript parser was written.

## The problem this branch actually solves

A confirmation is worthless if anyone who picks up the phone can give it.
"Did you authorize this $40 charge?" means nothing unless the voice answering
is the cardholder's.

So the call does two things at once: it has a natural conversation, and it
checks whether the person on the line is who the account says they are.

## Work worth reading

**The assistant is code, not dashboard config.** `lib/calling-agent/assistant.ts`
builds the whole thing — prompt, voice, model, webhook, structured-data schema —
and `npm run calling-agent:sync-assistant` upserts it by name. The prompt is
reviewable in a diff, and per-call differences ride as `assistantOverrides`
rather than spawning an assistant per call.

**The conversation has a designed shape**, not just a system prompt. Time-of-day
greeting, ask how they are, answer in kind *only if they ask back*, this month's
spend, then past payment history pulled from the user's Backboard memory, then
the renewal question. Each step exists because the previous version felt wrong
on a real call.

Two bugs that only appear when a model speaks out loud, both fixed by giving the
persona a real name and branching on whether one exists: asked to "introduce
yourself by name" with no name supplied, the model said the literal words *"my
name is agent name"*; asked to "confirm you're speaking with the right person"
with no name on file, it garbled trying.

**Identity is checked with a real speaker model, not a vibe.** `detectHuman()`
separates two questions that get conflated: is a live person on the line
(Vapi's voicemail classifier), and is it *this* user (ECAPA-TDNN cosine
similarity against their enrolled voiceprint, via the voice-verification
branch's Cloud Run service). Anti-spoofing is deliberately *not* used here and
the comment says why: a phone call already answers "is anyone really there", and
what's missing for purchase verification is identity.

**Webhook auth without a secret field.** Vapi removed inline `server.secret`, so
the assistant carries a custom header that Vapi echoes on every event and
`lib/calling-agent/webhook-auth.ts` checks. Every event is logged verbatim to
`calling_agent_events` before it's acted on — when a third-party integration
misbehaves, the raw payload is the only thing that settles what happened.

## The two-day bug

Every call died five seconds in with `pipeline-error-eleven-labs-voice-failed`
and an empty transcript. The voice id was correct. It was on the account.
`GET /v1/voices` listed it.

The cause was a plan restriction: the voice came from the ElevenLabs **Voice
Library**, and a free plan returns `402 paid_plan_required` for those, which
Vapi collapses into one opaque pipeline error. Presence checks can't catch it —
the voice genuinely is on the account.

What found it was bypassing the wrapper and synthesizing straight against
ElevenLabs: **402 means the plan, 401 means the key, 200 means look elsewhere.**
That three-way test is now in the docs, and `voiceConfig()` leads with the
diagnosis rather than the history.

## Stack

Next.js 15 · TypeScript · PostgreSQL · Vapi (`@vapi-ai/server-sdk`) ·
ElevenLabs · Google Gemini · ECAPA-TDNN via Cloud Run

See [`docs/CALLING_AGENT.md`](docs/CALLING_AGENT.md) for setup, the call
lifecycle, webhook security, and the Backboard context injection.
