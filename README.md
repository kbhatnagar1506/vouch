# voice-verification — speaker recognition, self-hosted

`voice.getvouch.club` · [full docs](docs/VOICE.md)

Enrolls a user's voiceprint and verifies later audio against it, so the calling
agent can tell whether the person who answered is the account holder.

The model runs on our own infrastructure: a FastAPI service on Cloud Run
(`services/voice-inference`) with **ECAPA-TDNN** for speaker embeddings and
**AASIST** for anti-spoofing. No voice-biometrics vendor in the path.

## The problem this branch actually solves

A phone confirmation only means something if you know who's on the phone.
Caller ID is trivially spoofed and a PIN is something anyone who has the account
already has. What's missing is a property of the *person*.

An ECAPA embedding is a 192-dimension vector summarising how a voice sounds.
Compare a new sample against the enrolled one by cosine similarity and you get a
number for "is this the same speaker" that survives different words, different
phrasing, and a different phone.

## Work worth reading

**Enrollment is a centroid, not a clip.** `averageEmbeddings` in
`app/api/voice/enroll/route.ts` takes three recordings and stores their
elementwise mean. One recording carries whatever was accidental about that
moment — a cold, a noisy room, an unusual cadence — and anchors every future
comparison to it. The mean of three is far less sensitive to any one being
atypical.

**Voiceprints are encrypted at rest.** A speaker embedding is biometric data, so
`voice_enrollments.embedding` holds AES-256-GCM ciphertext
(`lib/crypto.ts`, `iv:authTag:ciphertext`, all base64) rather than a plain JSON
array — the same treatment bank-connection gives Plaid access tokens. `ENCRYPTION_KEY`
is shared across branches specifically so calling-agent can decrypt an
enrollment it didn't create.

**The inference service is locked down twice.** Calls carry a Google-signed ID
token for Cloud Run's IAM invoker check *and* an app-level `X-Api-Key`. Either
alone would be defensible; both means a misconfigured IAM policy doesn't
immediately expose the model, and a leaked API key doesn't either.

**Anti-spoofing is measured, logged, and deliberately not enforced.** AASIST was
trained on clean ASVspoof2019 studio recordings, not compressed browser-mic
audio with echo cancellation. That channel mismatch produces false positives on
genuine speech, so the check runs and its score is logged for calibration but it
does **not** block enrollment. The comment in the route says exactly that, and
`docs/VOICE.md` has an "Anti-spoofing — what's left" section.

Shipping a security check that rejects real users is worse than shipping without
it. Collecting the data to calibrate it first is the honest path, and saying so
in the code is what stops someone flipping it on later without the calibration.

**No-speech is a 422, not a 500.** `NoSpeechError` is distinguished from a
service failure so the user is told which of the three clips to re-record,
rather than being shown a generic error for a problem they can fix.

## Two routes, on purpose

- `/voice` — the full demo: enroll, then live-monitor verification scores
- `/voice/register` — the onboarding step, enrollment only, then hands off to
  the dashboard

Same split as the dashboard branch's `/dashboard` and `/demo`: the thing that
shows the technology and the thing that's in a user's way are different pages
with different jobs.

## Stack

Next.js 15 · TypeScript · PostgreSQL · SpeechBrain (ECAPA-TDNN) · AASIST ·
FastAPI on Google Cloud Run · AES-256-GCM

See [`docs/VOICE.md`](docs/VOICE.md) for the service deployment, the threshold
calibration, and what anti-spoofing still needs.
