# Voice verification

Speaker verification (is this call from the same person who enrolled?) and
anti-spoofing (is this a live human voice, or a clone/replay?), used during
onboarding and at call time. Follows the same "one repo, one DB,
one branch/subdomain per service" convention as `bank-connection` — no
login/signup UI lives here, that's owned by the portal.

## Architecture

Two pieces, deployed separately:

1. **This Next.js branch** (`voice-verification`) — the browser-mic
   enrollment/verification UI (`/voice`), and API routes
   (`/api/voice/enroll`, `/api/voice/verify`, `/api/voice/status`) that
   require a portal session (see "Multi-tenancy" below), store/compare
   embeddings, and log verification attempts.
2. **`services/voice-inference`** — a standalone Python/FastAPI service
   doing the actual model inference. Deployed to **Cloud Run**, not
   Vercel — Next.js/Vercel can't run PyTorch model inference natively.
   The Next.js API routes call it over HTTP, authenticated two ways (see
   "Deploying the inference service to Cloud Run" below): a Cloud Run IAM
   invoker check via a Google-signed ID token, plus this app's own
   `VOICE_SERVICE_API_KEY` as defense-in-depth.

```
Browser mic  ──▶  /api/voice/enroll|verify  ──▶  voice-inference (Cloud Run)
                        │                              │
                        ▼                              ▼
                  voice_enrollments            speechbrain ECAPA-TDNN
                  voice_verifications          (+ AASIST, once wired up)
                  (shared Postgres)
```

## Models

- **Speaker verification**: [SpeechBrain's ECAPA-TDNN](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb),
  pretrained on VoxCeleb, used as a **frozen embedding extractor** — no
  training needed to stand this up. Enrollment stores one reference
  embedding per user (AES-256-GCM encrypted at rest, same treatment
  `bank-connection` gives Plaid access tokens — see `lib/crypto.ts`);
  verification compares a new clip's embedding to it by cosine similarity
  against `VOICE_MATCH_THRESHOLD` (default `0.75`).
- **Anti-spoofing**: intended to be [AASIST](https://github.com/clovaai/aasist)
  pretrained on ASVspoof2019 LA, detecting synthetic/cloned or replayed
  audio. **Not wired up yet** — `services/voice-inference/app/models.py`
  defines a pluggable `SpoofDetector` interface, but no checkpoint or model
  architecture is bundled in this repo. Until a real checkpoint is
  integrated, `/spoof-check` honestly reports `model_loaded: false` rather
  than fabricating a score, and the enroll/verify routes treat that as "spoof
  check skipped", not "not spoofed" — don't rely on anti-spoofing being
  enforced until this is finished.

### Why frozen pretrained models instead of training our own

Training ECAPA-TDNN/AASIST from scratch (or meaningfully fine-tuning them)
needs a large labeled dataset — VoxCeleb and ASVspoof both require
registering and accepting a license directly with their maintainers, which
hasn't been done yet — plus real GPU time. Using the published pretrained
checkpoints as frozen feature extractors gets a working, reasonably
accurate MVP live now, with no dataset or training cost. Fine-tuning on
top of that (e.g. once real usage data + dataset access exists) is a
later, separate project — see "Fine-tuning roadmap" below.

### Anti-spoofing — how to finish it

1. Get a pretrained AASIST checkpoint (e.g. from the
   [clovaai/aasist](https://github.com/clovaai/aasist) releases).
2. Port its model architecture into
   `services/voice-inference/app/models.py` (replace the
   `NotImplementedError` in `SpoofDetector.load()`), matching the
   checkpoint's `state_dict` keys.
3. Bake the checkpoint into the Cloud Run image (or mount it from GCS at
   startup) and set `AASIST_CHECKPOINT_PATH` to its path.

## Data model

`db/migrations/0001_voice_enrollments.sql`:

- `voice_enrollments` — one row per user, `embedding` (encrypted JSON
  float array), `model_version`.
- `voice_verifications` — append-only log of every verification attempt
  (`speaker_score`, `spoof_score`, `passed`), for audit/fraud review.

Run with `npm run db:migrate` (same pattern as every other branch — tracks
applied files in the shared `_migrations` table, safe to re-run).

## Multi-tenancy

Same contract as `bank-connection`: reads the `vouch_session` cookie the
portal issues (HS256 JWT, `{ userId, email }`, `JWT_SECRET` shared across
services, `SESSION_COOKIE_DOMAIN=.getvouch.club`). `middleware.ts` protects
`/voice` and `/api/voice/*` and redirects signed-out visitors to
`PORTAL_LOGIN_URL`. No auth is implemented here — see the portal branch.

## Deploying the inference service to Cloud Run

GCP project: **`patchguard-reakon`** (billing enabled, `run.googleapis.com`
enabled). The org has a domain-restricted-sharing policy that rejects
`allUsers`/`allAuthenticatedUsers` IAM bindings, so `--allow-unauthenticated`
isn't available — the service is deployed private and invoked via a
dedicated service account instead:

```sh
# One-time setup: a service account only Next.js uses to call this service,
# and its own IAM binding scoped to just this Cloud Run service (not the
# whole project).
gcloud iam service-accounts create voice-inference-caller \
  --project patchguard-reakon \
  --display-name "Vouch voice-inference caller (Next.js -> Cloud Run)"

gcloud run services add-iam-policy-binding vouch-voice-inference \
  --region us-central1 --project patchguard-reakon \
  --member "serviceAccount:voice-inference-caller@patchguard-reakon.iam.gserviceaccount.com" \
  --role roles/run.invoker

gcloud iam service-accounts keys create voice-inference-caller-key.json \
  --iam-account voice-inference-caller@patchguard-reakon.iam.gserviceaccount.com \
  --project patchguard-reakon
# base64 that key and set it as this branch's GCP_VOICE_CALLER_KEY_BASE64
# (Vercel env var) — see .env.example.

# Deploy / redeploy:
gcloud run deploy vouch-voice-inference \
  --source . \
  --project patchguard-reakon \
  --region us-central1 \
  --no-allow-unauthenticated \
  --set-env-vars VOICE_SERVICE_API_KEY=<same value as this branch's VOICE_SERVICE_API_KEY> \
  --memory 4Gi --cpu 2
```

`lib/voice-service.ts` mints a Google-signed ID token from
`GCP_VOICE_CALLER_KEY_BASE64` (via `google-auth-library`) for every call —
Cloud Run's own front end checks that in `Authorization` before the
request even reaches the container. `VOICE_SERVICE_API_KEY` is then
checked again inside the app via the `X-Api-Key` header (deliberately not
`Authorization`, which Cloud Run's IAM check already owns) — defense in
depth against IAM misconfiguration, not the only gate. Set
`VOICE_SERVICE_URL` (Vercel env var) to the deployed `*.run.app` URL.

A freshly-created IAM binding can take a minute or so to propagate — a
403 (as opposed to 401) right after `add-iam-policy-binding` usually means
"give it another moment," not a real misconfiguration.

CPU-only Cloud Run is enough for ECAPA-TDNN inference (embeddings for a
few seconds of audio take well under a second on CPU); GPU is only needed
for training/fine-tuning, not for serving frozen pretrained models.

## Fine-tuning roadmap (not started)

Deliberately not done as part of standing up this service — each of these
is a separate decision point:

1. **Dataset access** — register for VoxCeleb and/or ASVspoof2019, or
   substitute Vouch's own labeled enrollment/call recordings.
2. **GPU compute** — an A100 in `patchguard-reakon`/`us-central1` is
   available (1 on-demand + 16 preemptible A100 quota, confirmed via
   `gcloud compute regions describe us-central1`), either as a Compute
   Engine VM or a Vertex AI custom training job. Not provisioned — this is
   a cost-incurring step to do only when there's a dataset to train on.
3. **Training pipeline** — fine-tune ECAPA-TDNN on Vouch's own enrolled
   speakers and/or AASIST on collected spoof examples, evaluate against
   held-out data, and only then swap the pretrained checkpoints above for
   fine-tuned ones.
