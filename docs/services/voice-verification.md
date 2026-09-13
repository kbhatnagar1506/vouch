# Voice verification (`voice-verification` branch)

> Documents the `voice-verification` git branch of the Vouch monorepo as of
> commit `acb234e` ("Hand off to the dashboard once voice enrollment
> completes"). Deployed subdomain: **voice.getvouch.club**. Companion ML
> service deployed separately to **GCP Cloud Run** (project
> `patchguard-reakon`, region `us-central1`), not to Vercel.
>
> Written from the branch's own `docs/VOICE.md` and `CLAUDE.md`, verified
> and expanded against the actual code (`git show
> origin/voice-verification:<path>`) and cross-referenced against the root
> `ARCHITECTURE.md` on the production branch (`claude/vigilant-meitner-fxqi9c`)
> and the `calling-agent` branch's consumption of this service.

## Contents

1. [Purpose & role](#1-purpose--role)
2. [Repository layout](#2-repository-layout)
3. [Next.js side: API routes](#3-nextjs-side-api-routes)
4. [Client-side voice capture](#4-client-side-voice-capture)
5. [Python FastAPI inference service](#5-python-fastapi-inference-service)
6. [Dockerfile & image build](#6-dockerfile--image-build)
7. [Database schema](#7-database-schema)
8. [Environment variables](#8-environment-variables)
9. [The onboarding hand-off](#9-the-onboarding-hand-off)
10. [Known limitations](#10-known-limitations)

---

## 1. Purpose & role

This branch does two distinct jobs, both biometric, neither of them login:

| | Enrollment | Verification |
|---|---|---|
| **Question answered** | "What does this user's voice sound like?" | "Is this the same voice?" / "Is this a live human, not a clone/replay?" |
| **When** | Once, during onboarding (`/voice/register`) | During onboarding's own demo Live Monitor, and later, post-call, from `calling-agent` |
| **Writes** | `voice_enrollments` (one row per user, upsert) | `voice_verifications` (append-only attempt log) |
| **Cloud Run endpoint(s)** | `/embed` (+ advisory `/spoof-check`) | `/verify` (+ advisory `/spoof-check`) |

There is **no login/signup UI on this branch** — same contract as
`bank-connection`. It reads the shared `vouch_session` cookie the `portal`
branch issues and trusts it; `middleware.ts` is the only gate.

### Enrollment vs. verification split, concretely

Two separate pages exist on purpose:

- **`app/voice/page.tsx`** (`/voice`) — the original scaffolded demo: a
  tabbed "Enroll" + "Live Monitor" experience. Enroll records `ENROLL_SAMPLES`
  (3) clips and posts them to `/api/voice/enroll`; Live Monitor continuously
  records ~4.5s windows and posts each to `/api/voice/verify`, driving a
  live match/mismatch status ring. This page is untouched by later
  onboarding work and stays as a standalone demo/test surface.
- **`app/voice/register/page.tsx`** (`/voice/register`) — added in
  **"Add enrollment-only voice registration for the onboarding chain"**
  (commit `829b4a2`). This is the real onboarding step: signup/login →
  Gmail → bank → **here**. It does *only* the multi-sample enrollment flow
  (record 3 clips → `POST /api/voice/enroll`) and then a completion screen
  that hands off to the dashboard (see [§9](#9-the-onboarding-hand-off)).
  It deliberately does not expose Live Monitor at all — that's a
  verification/demo feature, not something a new user needs to see while
  onboarding. The commit message is explicit that this was a new,
  additive page rather than a modification of `/voice`, and that
  `middleware.ts`'s existing `/voice/:path*` matcher already covered the
  new route with no middleware changes needed.

**Live/post-call verification, used by `calling-agent`:** the `/api/voice/verify`
route on *this* branch is only reachable by an authenticated Vouch user
acting on their own session (it looks up the caller's own enrollment by
`user_id` from the session cookie) — it's what `/voice`'s Live Monitor tab
calls. `calling-agent` (a sibling branch) does **not** call this branch's
API at all; it talks to the same Cloud Run `voice-inference` service
directly, with its own trimmed-down client
(`lib/calling-agent/voice-match.ts`, "ported... rather than shared across
branches" per its header comment, following the root `CLAUDE.md` "branches
never import code from each other" rule) that only calls `/verify`. After a
Vapi call ends, `calling-agent`'s `detectHuman()`
(`lib/calling-agent/human-detection.ts`) fetches the call recording,
decrypts the user's `voice_enrollments.embedding` (reading the *same*
shared Postgres table this branch writes to) and posts it to `/verify`
to answer "is this specifically the account owner's voice, not just any
human." See [§10](#10-known-limitations) for why that check is post-call,
not live.

---

## 2. Repository layout

### Next.js app (deploys to Vercel, subdomain `voice.getvouch.club`)

| Path | Purpose |
|---|---|
| `app/api/auth/logout/route.ts` | `POST` — clears the `vouch_session` cookie locally (e.g. a "log out" click from `/voice`). |
| `app/api/auth/me/route.ts` | `GET` — returns the current session user (or `null`), used by both voice pages to show the signed-in email. |
| `app/api/health/route.ts` | `GET` — Postgres connectivity check (`select now(), version()`), unauthenticated, backs the root `/` page. |
| `app/api/voice/enroll/route.ts` | `POST` — multi-clip voice enrollment; the core of this branch. See [§3](#3-nextjs-side-api-routes). |
| `app/api/voice/status/route.ts` | `GET` — whether the current user has an enrollment on file. |
| `app/api/voice/verify/route.ts` | `POST` — one speaker-verification + spoof-check attempt against the stored enrollment. |
| `app/voice/page.tsx` | `/voice` — the original Enroll + Live Monitor demo UI (untouched by the onboarding work). |
| `app/voice/register/page.tsx` | `/voice/register` — the real onboarding step: enrollment-only, then hands off to the dashboard. |
| `app/layout.tsx` | Root layout — sets `<html>`/`<body>`, page metadata (title/description "Vouch"). |
| `app/page.tsx` | `/` — minimal scaffold page showing the DB health-check result (leftover from initial scaffolding, not part of the voice product surface). |
| `app/globals.css` | Tailwind 4 import (`@import "tailwindcss"`) plus two base rules (`color-scheme`, body font/margin reset). |
| `lib/auth.ts` | Re-exports session-token primitives + `getUserById()` (the one place in this file that touches Postgres). |
| `lib/crypto.ts` | AES-256-GCM `encryptSecret`/`decryptSecret` for values at rest (used here for voice embeddings). |
| `lib/db.ts` | Shared lazy-constructed `pg` `Pool`, proxied so `pool.query(...)` call sites don't change; avoids crashing `next build`/route analysis when `DATABASE_URL` isn't set yet. |
| `lib/session-token.ts` | Pure JWT (HS256 via `jose`) cookie logic, **no DB import** — used from `middleware.ts` on the Edge runtime, which can't load `pg`. Must match the portal's claim/cookie contract exactly. |
| `lib/session.ts` | `getCurrentUser()` / `requireUser()` for Server Components and Route Handlers (reads cookies via `next/headers`, then hits the DB via `lib/auth.ts`). |
| `lib/use-live-monitor.ts` | Client hook: continuous mic sampling, scoring, rolling-average smoothing, asymmetric match/mismatch state machine. See [§4](#4-client-side-voice-capture). |
| `lib/use-voice-recorder.ts` | Client hook: single-clip mic recording (webm) + live volume level for the record-button animation. See [§4](#4-client-side-voice-capture). |
| `lib/voice-service.ts` | Server-side client for the Cloud Run `voice-inference` service — IAM ID-token + API-key auth, `/embed` `/verify` `/spoof-check` wrappers, `NoSpeechError`. See [§3](#3-nextjs-side-api-routes). |
| `middleware.ts` | Edge middleware gating `/voice/:path*` and `/api/voice/:path*` on a valid session cookie; redirects signed-out page visitors to `PORTAL_LOGIN_URL`, 401s API calls. |
| `scripts/migrate.mjs` | Minimal SQL migration runner (`db/migrations/*.sql` in filename order, tracked in a shared `_migrations` table); run via `npm run db:migrate`. |
| `db/migrations/0001_voice_enrollments.sql` | Creates `voice_enrollments` and `voice_verifications`. See [§7](#7-database-schema). |
| `docs/VOICE.md` | This branch's own architecture doc — models, thresholds, Cloud Run deployment steps, fine-tuning roadmap, calibration plan. |
| `.env.example` | Template for every env var this branch's Next.js side reads. |
| `next.config.ts` | Empty/default Next.js config (no custom options set). |
| `package.json` | Next.js 15.5 / React 19 / TypeScript 5.7 app; deps: `pg`, `jose`, `google-auth-library`; devDeps: Tailwind 4. |
| `middleware.ts`, `tsconfig.json`, `postcss.config.mjs` | Standard Next.js/Tailwind/TS project plumbing, no voice-specific logic. |
| `public/logo1.png` | Vouch wordmark used on both voice pages. |
| `.gitignore` | Excludes `.env*`, `node_modules/`, `.next/`, `.vercel`, plus (shared with the Python side) `__pycache__/`, `*.pyc`. |

### Python service (`services/voice-inference/`, deploys separately to Cloud Run — not part of the Vercel build)

| Path | Purpose |
|---|---|
| `Dockerfile` | Builds the Cloud Run image: Python 3.11-slim + ffmpeg, bakes ECAPA-TDNN weights in at build time. See [§6](#6-dockerfile--image-build). |
| `.dockerignore` | Excludes `__pycache__/`, `*.pyc`, `.venv/` from the build context. |
| `requirements.txt` | Pinned deps — see [§8](#8-environment-variables) note on versions below. |
| `app/__init__.py` | Empty — makes `app` a package. |
| `app/main.py` | FastAPI app: route definitions, API-key auth dependency, startup model preload, `/health`. See [§5](#5-python-fastapi-inference-service). |
| `app/models.py` | Model loading/inference: `get_speaker_model()` (ECAPA-TDNN via SpeechBrain), `embed()`, `cosine_similarity()`, and the `SpoofDetector` class wrapping AASIST. |
| `app/aasist_model.py` | AASIST graph-attention-network architecture, vendored unmodified from the upstream repo (MIT). Pure PyTorch `nn.Module` definitions — no Vouch-specific code. |
| `app/audio.py` | Decodes an uploaded clip (webm/opus/wav/whatever `pydub`+ffmpeg supports) to a mono 16kHz float32 waveform; logs decode diagnostics. |
| `app/vad.py` | Silero VAD wrapper — `trim_to_speech()` trims a waveform to just its detected-speech portion, or returns `None`. |
| `app/weights/aasist.pth` | Pretrained AASIST checkpoint (binary, PyTorch state dict, ASVspoof2019 LA), ~1.28 MB (`1,281,532` bytes), vendored from the upstream `aasist` repo. Baked into the Docker image, not fetched at runtime. |
| `THIRD_PARTY_LICENSES/aasist-LICENSE` | MIT license text for the vendored AASIST code + checkpoint (Copyright NAVER Corp.). |

---

## 3. Next.js side: API routes

All three `/api/voice/*` routes require a valid `vouch_session` cookie —
enforced twice: `middleware.ts` 401s unauthenticated requests before they
reach the route at all, and each handler independently calls
`requireUser()` (`lib/session.ts`), which throws `UnauthorizedError` → 401
if `middleware.ts` were ever bypassed or misconfigured.

### `POST /api/voice/enroll`

| | |
|---|---|
| **Auth** | Session cookie (`requireUser()`) |
| **Request** | `multipart/form-data`, one or more `audio` fields (webm blobs) |
| **Calls Cloud Run** | `checkSpoof()` then `embedAudio()` (`/spoof-check`, `/embed`) for **each** clip |
| **Writes** | `voice_enrollments` — upsert on `user_id` |
| **Response** | `200 { ok: true, model_version, samples }` |
| **Errors** | `400` no audio; `422 { error, }` a clip had no detectable speech (`NoSpeechError`); `401` unauthenticated; `500` other failure |

Flow (`app/api/voice/enroll/route.ts`):

1. Pull every `audio` file out of the form (filters to non-empty `Blob`s).
2. For each clip, in order: call `checkSpoof()` and `console.log` the
   result (`[voice/enroll] spoof-check`, including `userId`, clip index,
   `model_loaded`, `spoof_score`, `is_spoof`) — **advisory only, never
   blocks** (see the inline comment citing AASIST's channel mismatch on
   browser-mic audio); then call `embedAudio()`. A `NoSpeechError` from
   *any* clip aborts the whole request with a `422` naming which clip
   number failed, rather than partially enrolling.
3. If more than one clip succeeded, elementwise-average their embedding
   vectors (`averageEmbeddings()` — "a centroid enrollment is less
   sensitive to any single recording being atypical or noisy than storing
   just one clip's embedding"); a single clip is stored as-is.
4. `encryptSecret(JSON.stringify(averaged))` (AES-256-GCM, `lib/crypto.ts`)
   and upsert into `voice_enrollments` (`on conflict (user_id) do update`
   — re-enrolling replaces the old embedding and bumps `updated_at`).

Both onboarding surfaces call this same route: `/voice`'s Enroll tab and
`/voice/register` both `POST` here with `ENROLL_SAMPLES = 3` clips.

### `POST /api/voice/verify`

| | |
|---|---|
| **Auth** | Session cookie (`requireUser()`) |
| **Request** | `multipart/form-data`, single `audio` field |
| **Calls Cloud Run** | `verifyAudio()` and `checkSpoof()`, concurrently (`Promise.all`) — `/verify`, `/spoof-check` |
| **Writes** | `voice_verifications` — one append-only row per call |
| **Response** | `200 { passed, speaker: {score, threshold, match}, spoof: {score, is_spoof, model_loaded} }` |
| **Errors** | `400` no audio; `404` no enrollment on file for this user; `422 { error, noSpeech: true }` no speech detected; `401`/`500` as above |

Flow (`app/api/voice/verify/route.ts`):

1. Load the caller's own `voice_enrollments.embedding`, `decryptSecret()`
   it and `JSON.parse` back to a `number[]`. `404` if the user never
   enrolled.
2. Run `verifyAudio(audio, referenceEmbedding)` and `checkSpoof(audio)` in
   parallel against the submitted clip.
3. `passed = speaker.match` **only** — the spoof result (`spoofed =
   spoof.model_loaded && spoof.is_spoof`) is computed, logged
   (`[voice/verify] spoof-check`), returned in the response body, and
   shown in the UI, but never affects `passed`. The code comment is
   explicit: *"Advisory only for now, not gating — see the enroll route
   for why."*
4. Insert into `voice_verifications` — `spoof_score` is written as `null`
   when `spoof.model_loaded` is false (checkpoint missing), never a
   fabricated score.

This is the route both `/voice`'s Live Monitor tab polls every ~4.5s and,
indirectly, what every `verifyAudio()` call anywhere in the system
ultimately maps to on the inference side — though `calling-agent`'s own
verification path calls the Cloud Run service directly rather than this
Next.js route (see [§1](#1-purpose--role)).

### `GET /api/voice/status`

| | |
|---|---|
| **Auth** | Session cookie (`requireUser()`) |
| **Request** | none |
| **Calls Cloud Run** | no |
| **Response** | `200 { enrolled: boolean, enrolledAt: string \| null, modelVersion: string \| null }` |

Reads `voice_enrollments` for the current user only; drives the "Enroll
your voice first" gate on the Live Monitor tab and the status text on
first load of `/voice`.

### `lib/voice-service.ts` — the Cloud Run client

The one place in this branch that talks to the Python service over HTTP.
Confirmed in code: **two independent auth layers** on every call, exactly
as `docs/VOICE.md` and the root `ARCHITECTURE.md` describe them:

1. **Cloud Run IAM invoker check (Google-signed ID token).** `getAuth()`
   lazily builds a `google-auth-library` `GoogleAuth` client from the
   service-account JSON embedded in `GCP_VOICE_CALLER_KEY_BASE64` (base64
   → `JSON.parse` → `credentials`), cached on `global._voiceServiceAuth`.
   `getAuthHeaders()` calls `getAuth().getIdTokenClient(getServiceUrl())`
   then `client.getRequestHeaders()`, which mints a fresh Google-signed ID
   token and puts it in `Authorization`. This is checked by **Cloud Run's
   own front end**, outside the FastAPI app entirely — enforced by
   deploying with `--no-allow-unauthenticated` plus an IAM `run.invoker`
   binding scoped to the `voice-inference-caller` service account
   (`docs/VOICE.md`'s deploy steps), not by any line of Python.
2. **App-level `VOICE_SERVICE_API_KEY`, as `X-Api-Key`.** Added in the same
   `getAuthHeaders()` call, deliberately a different header name than
   `Authorization` so it can't collide with the IAM token. This one *is*
   checked in application code — `main.py`'s `require_api_key`
   dependency, `Depends()`-injected on `/embed`, `/verify`, `/spoof-check`
   (not `/health`). Confirms the "defense in depth" framing in root
   `ARCHITECTURE.md` §2: IAM auth gates the request from ever reaching the
   container; the API key is a second, independent check inside it.

`postAudio()` is the shared low-level POST helper: builds a `FormData`
with the clip as `audio` (filename `sample.webm`), any extra string
fields, sends it to `${VOICE_SERVICE_URL}${path}` with the two auth
headers above, and on a non-OK response either throws `NoSpeechError`
(if `422` and the body contains `no_speech_detected`) or a generic
`Error` with the status and response text. Three typed wrappers sit on
top: `embedAudio()`, `verifyAudio(audio, referenceEmbedding)` (adds a
`reference_embedding` form field, JSON-stringified), `checkSpoof()`.

---

## 4. Client-side voice capture

Both hooks are `"use client"` and record via `navigator.mediaDevices.getUserMedia({ audio: true })` + the browser's built-in `MediaRecorder`, which on Chromium/Firefox defaults to **webm container / Opus codec** — matching the root docs' "webm/opus" description and `app/audio.py`'s decode comment ("webm/opus from the browser"). Neither hook sets an explicit `mimeType`; recorded blobs are labeled `audio/webm` (single-clip) or left to the browser's default for live-monitor chunks.

### `lib/use-voice-recorder.ts` — single-clip recorder (used by both Enroll flows)

- `start()`: opens the mic, wires an `AudioContext` → `AnalyserNode`
  (`fftSize = 256`) purely for a live **RMS volume level** (`0–1`, `rms *
  4` clamped) driving the pulsing record-button UI — this analyser plays
  no role in what gets sent to the server. Starts a `MediaRecorder` on
  the raw stream and accumulates `ondataavailable` chunks.
- `stop()`: stops the recorder, closes the `AudioContext`, stops all
  media tracks, and resolves a single `Blob` (`type: "audio/webm"`) from
  the accumulated chunks (`null` if nothing was captured).
- No VAD, no silence gate here at all — every recorded clip is sent to
  `/api/voice/enroll` regardless of content; server-side Silero VAD
  (§5) is what actually rejects a silent/no-speech clip (`422
  no_speech_detected`), surfaced back through `NoSpeechError`.
- State machine: `idle → recording → stopped`; `reset()` returns to `idle`.

### `lib/use-live-monitor.ts` — continuous verification loop (Live Monitor tab, `/voice` only)

This is the piece with the most iterated-on tuning, and the code comments
name the real numbers behind each constant:

- **Window size — `CHUNK_MS = 4500`.** ECAPA-TDNN needs a few seconds of
  clean speech; a 2.2s window was tested and produced an 18% same-speaker
  similarity score — unusably noisy. 4.5s trades reaction time for
  accuracy, and also absorbs the opus-encoder warm-up cost each fresh
  `MediaRecorder` instance pays at the start of its window.
- **Client-side amplitude gate — `SILENCE_PEAK_THRESHOLD = 0.06`.** A
  cheap peak-amplitude check (via the same `AnalyserNode`/`getByteTimeDomainData`
  pattern as the recorder hook) run *while* each window records; if the
  peak never crosses this, the window is skipped entirely (never sent to
  `/api/voice/verify`) and the current status just holds. Explicitly
  **not real VAD** — "enough to ignore silence," with the real VAD
  happening server-side (§5) and its "no speech" verdict (`result ===
  null`, since `verifyChunk()` in `app/voice/page.tsx` returns `null` on
  `data.noSpeech`) also just holds status rather than counting as data.
- **Score smoothing — `SCORE_HISTORY_SIZE = 3`, a rolling average.**
  Added in **"Smooth live-monitor status with a rolling score average"**
  (`3ef01ab`). Comment cites real testing: the *same* speaker's raw
  cosine score ranged **0.09 to 0.61** across consecutive 4.5s windows in
  one session — too noisy to react to a single window directly. Each
  verify result's `score` is pushed onto `scoreHistoryRef` (capped at 3,
  FIFO via `.shift()`).
- **Asymmetric recovery** (fixed in **"Fix live-monitor getting stuck on
  mismatch: asymmetric recovery"**, `d98c164`): match/mismatch is *not*
  symmetric around the rolling average.
  - If the **current single window's raw score** already clears the
    threshold, status flips to `"match"` **immediately** — "quick to
    reassure: one clear match clears an alarm immediately, rather than
    waiting for a rolling average to recover from a single bad window
    still sitting in it."
  - Otherwise, status is decided by the **rolling average** of the last 3
    scores vs. threshold — "slow to alarm: only flag 'mismatch' once the
    recent average... is actually low," so one noisy low window alone
    can't flip a healthy session to mismatch.
  - This asymmetry is exactly what fixes the "stuck on mismatch" bug
    named in that commit's title: a symmetric rolling-average comparison
    would keep a stale low score in the average for up to 2 more windows
    even after the speaker started scoring well again.
- **Debounce / longer window** (`8d14a5b`, "Fix live-monitor false
  mismatches: longer window + debounce") is the ancestor of the current
  `CHUNK_MS = 4500` + rolling-average design above — by the current code,
  "debounce" has fully evolved into the rolling-average + asymmetric
  logic rather than existing as a separate timer.
- **Calibration groundwork** (`fc0027f`, "Add real VAD, multi-sample
  enrollment, and calibration groundwork") is what put server-side Silero
  VAD, 3-clip averaged enrollment, and the `voice_verifications` audit log
  in place — the raw material `docs/VOICE.md`'s "Calibrating
  VOICE_MATCH_THRESHOLD with real data" section says to query once real
  negative trials exist.
- **Loop mechanics:** `start()` opens the mic once and keeps it open for
  the whole session; `loop()` repeatedly calls `recordWindow()` (records
  exactly `CHUNK_MS`, tracking peak amplitude via `requestAnimationFrame`
  alongside the `MediaRecorder`), and for any non-silent window awaits
  the caller-supplied `verify` callback (`app/voice/page.tsx`'s
  `verifyChunk`, which itself POSTs to `/api/voice/verify`). `stop()`
  flips `activeRef.current = false` (loop exits after its current await),
  stops all tracks, closes the `AudioContext`, and resets status to
  `"idle"` and the score history.
- Status values: `idle | listening | match | mismatch | error`
  (`LiveStatus`). `/voice/page.tsx` renders a full-screen red inset-shadow
  pulse overlay whenever `status === "mismatch"`.

---

## 5. Python FastAPI inference service

`services/voice-inference/app/main.py` defines the whole API surface.
Exact routes, confirmed in code:

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Cloud Run startup/liveness probe target. `503` until `models.is_speaker_model_loaded()` is true; `200 {"ok": true}` once it is. Does **not** check the AASIST/VAD models — only the ECAPA-TDNN speaker model. |
| `POST` | `/embed` | `X-Api-Key` (`require_api_key`) | Decodes + VAD-trims the upload, runs ECAPA-TDNN, returns the raw embedding. |
| `POST` | `/verify` | `X-Api-Key` | Same decode/trim/embed, then cosine-similarity against a caller-supplied `reference_embedding` form field. |
| `POST` | `/spoof-check` | `X-Api-Key` | Same decode/trim, then AASIST spoof probability. |

(All three POST routes additionally sit behind Cloud Run's own IAM invoker
check at the platform level — see §3's `lib/voice-service.ts` writeup;
that layer isn't visible as Python code.)

### `require_api_key` (in `main.py`)

```python
def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    expected = os.environ.get("VOICE_SERVICE_API_KEY")
    if not expected:
        raise HTTPException(status_code=500, detail="VOICE_SERVICE_API_KEY is not set on the server")
    if x_api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid API key")
```

Straight string comparison against the `X-Api-Key` header (not
constant-time, not hashed) — adequate as a second, defense-in-depth layer
behind the IAM check, not a standalone secret-grade comparison.

### Startup: eager load, no cold-start tax on real traffic

`@app.on_event("startup") def preload_models()` calls
`models.get_speaker_model()`, `models.spoof_detector.load()`, and
`vad.get_vad_model()` — all three models loaded into memory once, at
process start, not lazily on first request. This is the change from
**"Eliminate cold-start latency: eager model load + startup probe"**
(`5ddaca8`): paired with Cloud Run's `--startup-probe` hitting `/health`
(configured in `docs/VOICE.md`'s deploy command with
`initialDelaySeconds=0, timeoutSeconds=3, periodSeconds=3,
failureThreshold=30`), Cloud Run withholds traffic from a new instance
until the speaker model is actually loaded — so even a fresh deploy's
*first* real request is fast, not just the second one. Combined with
`--min-instances 1` (keeps one warm instance always running, ~$15-30/mo
per `docs/VOICE.md`), this eliminates cold starts for real users
entirely rather than merely reducing their frequency.

### `app/models.py` — model loading + inference

- **`get_speaker_model()`** — lazily (on first call, guarded by a
  `threading.Lock` double-checked-locking pattern) imports
  `speechbrain.inference.speaker.EncoderClassifier` and loads
  `speechbrain/spkrec-ecapa-voxceleb` via `.from_hparams(source=...,
  savedir=os.environ.get("SPEECHBRAIN_CACHE_DIR", "/tmp/speechbrain/ecapa"))`.
  `MODEL_VERSION = "speechbrain/spkrec-ecapa-voxceleb"` is what's stored
  in `voice_enrollments.model_version` and returned from `/embed`.
- **`embed(waveform)`** — `model.encode_batch(waveform)` under
  `torch.no_grad()`, squeezed to a plain `list[float]`.
- **`cosine_similarity(a, b)`** — `torch.nn.functional.cosine_similarity`
  on the two embeddings as 1-row tensors.
- **`SpoofDetector`** class wraps AASIST:
  - `checkpoint_path` defaults to `app/weights/aasist.pth` next to this
    file, overridable via `AASIST_CHECKPOINT_PATH`.
  - `load()` is a no-op if the checkpoint file doesn't exist at that path
    — `self._model` simply stays `None` forever, rather than raising.
    This is the mechanism behind `model_loaded: false` in API responses.
  - `score(waveform)` pads/tiles the waveform to AASIST's fixed
    `nb_samp = 64600` samples (~4.04s at 16kHz, "the reference repo's
    fixed eval input length") via `_pad_or_tile()` — **deterministic**
    tile-then-truncate, explicitly not a random crop, "so the same clip
    always scores the same." Runs the model, softmaxes the 2-class
    logits, and returns **index 0** as the spoof probability — the
    in-code comment explains index 1 is "bonafide" per the vendored
    repo's training-label convention, so spoof probability is the
    complementary mass at index 0. Returns `None` (not a score) if the
    model never loaded.

### `AASIST_MODEL_CONFIG`

Hardcoded in `models.py`, matching the vendored architecture's expected
hyperparameters (`filts`, `gat_dims`, `pool_ratios`, `temperatures`,
`first_conv=128`, `nb_samp=64600`) — must match whatever `aasist.pth` was
trained with, since these shapes are baked into the checkpoint's tensors.

### `app/aasist_model.py`

Vendored **unmodified** from `github.com/clovaai/aasist`
(`models/AASIST.py`), MIT-licensed (NAVER Corp.). Pure PyTorch: a
`SincConv`-based front end (`CONV`, mel-scale band-pass filters),
residual conv blocks, spectral + temporal graph-attention branches
(`GraphAttentionLayer`, `HtrgGraphAttentionLayer`), learnable graph
pooling (`GraphPool`), and a final 2-class linear head (`out_layer`,
`5 * gat_dims[1] → 2`). No Vouch-specific logic lives in this file —
`app/models.py` is the integration point (config dict, checkpoint
loading, pre/post-processing).

### `app/audio.py` — decode + preprocessing

`decode_to_waveform(raw_bytes)`: `pydub.AudioSegment.from_file()` (ffmpeg
under the hood — "torchaudio alone doesn't reliably decode webm without an
ffmpeg-backed build") decodes whatever container the client sent, converts
to mono + resamples to `TARGET_SAMPLE_RATE = 16_000`, then normalizes the
integer PCM samples to a `[-1, 1]` float32 tensor of shape `(1,
num_samples)`. Also logs (`uvicorn.error` logger) input/output decode
characteristics — sample width/rate/channels in, duration/min/max/mean/std
out — added in **"Add diagnostic logging to the audio decode path"**
(`f7ca632`) specifically to distinguish "some chunks decode to garbage"
from "it's a model/threshold problem" while chasing the same-speaker
score-instability issue narrated throughout `docs/VOICE.md`.
`duration_seconds(waveform)` is a trivial `shape[-1] / TARGET_SAMPLE_RATE`
helper, surfaced in `/embed`'s response.

### `app/vad.py` — Silero VAD

`get_vad_model()` lazily loads `silero_vad.load_silero_vad()` (guarded the
same double-checked-lock way as the speaker model). `trim_to_speech(waveform)`
runs `get_speech_timestamps()` then `collect_chunks()` to concatenate just
the detected-speech segments; returns `None` if no speech timestamps came
back at all — the signal every route maps to a `422 no_speech_detected`.
Ships its own weights inside the `silero-vad` pip package — "no network
fetch at runtime, no HF-style rate-limit risk," an explicit contrast with
the speaker model's Hugging Face download problem (see §6).

### `app/models.py` (schemas) — **note**

Despite the file being named `models.py`, this branch has **no separate
Pydantic request/response schema module** — FastAPI's route signatures in
`main.py` use plain parameter types (`UploadFile`, `Form(...)`, `Header`)
and return plain `dict`s, which FastAPI serializes directly; there's no
`pydantic.BaseModel` class anywhere in the service. `app/models.py` is
entirely about ML **model loading/inference** (`get_speaker_model`,
`embed`, `cosine_similarity`, `SpoofDetector`), not data schemas — a naming
collision with the "pydantic schemas" expectation worth flagging
explicitly so nobody goes looking for a `models.py` full of `BaseModel`
classes and comes away thinking one was deleted.

### Confirmed: thresholds and advisory-only spoof-check, in code

- **`VOICE_MATCH_THRESHOLD` default `0.5`** — `main.py`:
  `DEFAULT_MATCH_THRESHOLD = 0.5`, read per-request as
  `float(os.environ.get("VOICE_MATCH_THRESHOLD", DEFAULT_MATCH_THRESHOLD))`
  in the `/verify` handler. Matches root `ARCHITECTURE.md`'s "cosine
  similarity... threshold 0.5" exactly. History: originally `0.75`
  (`docs/VOICE.md`'s own diff shows this), lowered in **"Lower default
  speaker-match threshold to 0.5"** (`aab8e24`) after `0.75` rejected a
  genuine same-speaker verification scoring 66.9% similarity in real
  testing. Docs are explicit that `0.5` is "still not calibrated against
  real negative/different-speaker trials, just less wrong than 0.75 was."
- **`SPOOF_THRESHOLD` default `0.5`** — `/spoof-check` handler:
  `float(os.environ.get("SPOOF_THRESHOLD", 0.5))`.
- **Anti-spoofing is advisory, confirmed on both call sites, not just
  docs:** `app/api/voice/enroll/route.ts` calls `checkSpoof()`, logs the
  result, and **never branches on it** — every enrollment proceeds
  regardless of `is_spoof`. `app/api/voice/verify/route.ts` computes
  `spoofed = spoof.model_loaded && spoof.is_spoof` and returns it in the
  response/UI, but `passed = speaker.match` alone — `spoofed` never
  enters that expression. This is the change from **"Make spoof-check
  advisory, not blocking — false positives on real speech"** (`711b548`),
  which followed directly after **"Wire up real anti-spoofing (AASIST)"**
  (`c54fbd0`) first made it blocking.

---

## 6. Dockerfile & image build

`services/voice-inference/Dockerfile`:

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV SPEECHBRAIN_CACHE_DIR=/app/pretrained_models/ecapa
RUN python -c "from app.models import get_speaker_model; get_speaker_model()"
ENV HF_HUB_OFFLINE=1
ENV PORT=8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
```

- **Base image:** `python:3.11-slim`, plus `ffmpeg` installed via `apt`
  (required by `pydub` to decode webm/opus).
- **Weights baked in at build time, not downloaded at runtime — for
  both models, though by two different mechanisms:**
  - **ECAPA-TDNN:** the `RUN python -c "from app.models import
    get_speaker_model; get_speaker_model()"` line *executes the model
    loader during the image build*, with `SPEECHBRAIN_CACHE_DIR` already
    pointed at `/app/pretrained_models/ecapa` — so SpeechBrain's
    from-Hugging-Face download happens once, at build time, and the
    downloaded weights are committed into the image layer at that path.
    Because Docker `ENV` values persist from build time into the
    container's runtime environment (unlike `ARG`), the same
    `SPEECHBRAIN_CACHE_DIR=/app/pretrained_models/ecapa` is still in
    effect when the container actually runs — so `get_speaker_model()`'s
    runtime call finds the weights already on disk and never re-downloads.
    `ENV HF_HUB_OFFLINE=1` (set *after* the bake-in `RUN`, so it doesn't
    interfere with that one legitimate download) then hard-disables any
    Hugging Face Hub network access for the life of the running
    container — "the service still starts if HF is down." This is the
    fix from **"Bake ECAPA-TDNN weights into the voice-inference image"**
    (`38b5a28`), motivated by Cloud Run containers being ephemeral (every
    cold start would otherwise re-download from HF) and by the shared
    Cloud Run egress IP getting HF's anonymous-download rate limit
    (429s) under repeated deploys/cold starts.
  - **AASIST:** no build-time download step at all — `app/weights/aasist.pth`
    (~1.28 MB) is a binary file **committed directly into the git repo**
    (`services/voice-inference/app/weights/aasist.pth`) and simply
    `COPY`'d into the image as part of `COPY app ./app`, since it "ships
    in that same [upstream] repo, no separate download needed" per
    `docs/VOICE.md`.
- **Two intermediate build fixes** visible in history before the bake-in
  landed: **"Fix voice-inference build: speechbrain needs requests
  explicitly"** (`8205a30`) and **"Pin huggingface_hub for speechbrain
  compatibility"** (`2fb9791`) — both `requirements.txt` entries
  (`requests`, `huggingface_hub==0.23.4`) trace back to these.
- **Port:** Cloud Run injects `$PORT` at runtime (defaults `ENV PORT=8080`
  for local `docker run`); `uvicorn` binds `0.0.0.0:${PORT}`, expanded via
  shell form `CMD exec ...` (not JSON-array form) specifically so the
  `${PORT}` variable substitution works, and `exec` so uvicorn becomes
  PID 1 (correct signal handling for Cloud Run's SIGTERM on scale-down).
- **No `EXPOSE` instruction** in the Dockerfile — Cloud Run doesn't rely on
  it (it reads `$PORT`/the listening socket directly), so this is a purely
  cosmetic omission, not a functional one.

---

## 7. Database schema

`db/migrations/0001_voice_enrollments.sql`, applied via `npm run
db:migrate` (tracked in the shared `_migrations` table, safe to re-run —
`scripts/migrate.mjs`):

```sql
create table if not exists voice_enrollments (
  user_id text primary key references users(id) on delete cascade,
  embedding text not null,
  model_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists voice_verifications (
  id bigserial primary key,
  user_id text not null references users(id) on delete cascade,
  speaker_score double precision,
  spoof_score double precision,
  passed boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists voice_verifications_user_id_idx
  on voice_verifications (user_id, created_at desc);
```

| Table | Rows | Notes |
|---|---|---|
| `voice_enrollments` | One per user (`user_id` is the primary key — enrolling again **replaces** the row via the enroll route's `on conflict (user_id) do update`, it does not version) | `embedding` is `text`, holding the `iv:authTag:ciphertext` (all base64) format `lib/crypto.ts`'s `encryptSecret()` produces — **not** a `vector`/`float[]` column, despite the root `ARCHITECTURE.md` noting the shared Postgres instance has `pgvector` available generally (used by `gmail-connector`); this branch stores the embedding as opaque encrypted text and does all comparison (cosine similarity) inside the Python service after decrypting in Node, not as a SQL/pgvector operation. `model_version` records which embedding model produced it (`speechbrain/spkrec-ecapa-voxceleb`), letting a future model swap be detected per-row. |
| `voice_verifications` | Append-only, one row per `/api/voice/verify` call | `speaker_score`/`spoof_score` are nullable `double precision` (`spoof_score` is `null` whenever `spoof.model_loaded` is false); `passed` is `not null` and — per §5/§3 above — currently reflects `speaker.match` alone, spoof status is not factored in despite being logged in the same row. Indexed on `(user_id, created_at desc)` for the "pull this user's recent attempts" access pattern `docs/VOICE.md`'s calibration plan describes. |

**Encryption confirmed in code, matching root `ARCHITECTURE.md`'s claim**
("Sensitive values are encrypted at rest with AES-256-GCM... voice
embeddings (biometric data) and Plaid access tokens"): both the enroll
route (`encryptSecret(JSON.stringify(averaged))`) and the verify route
(`JSON.parse(decryptSecret(enrollment.embedding))`) round-trip through
`lib/crypto.ts`'s `aes-256-gcm` implementation — a random 12-byte IV per
encryption, auth tag captured via `getAuthTag()`, stored as
`iv:authTag:ciphertext` (colon-joined base64). The key comes from
`ENCRYPTION_KEY` (must base64-decode to exactly 32 bytes); there is no
key rotation mechanism — changing `ENCRYPTION_KEY` would make every
existing `voice_enrollments.embedding` row undecryptable.

Ownership per root `ARCHITECTURE.md` §8: this branch owns exactly these
two tables in the shared instance; `user_id` is `text` throughout (per
the portal's convention) with `references users(id) on delete cascade` —
deleting a user cascades away their voice data.

---

## 8. Environment variables

### Next.js side (`voice-verification` branch, Vercel — Preview environment; see `.env.example`)

| Variable | Purpose | Required |
|---|---|---|
| `DATABASE_URL` | Shared Tiger Cloud Postgres connection string (`lib/db.ts`). | Yes |
| `JWT_SECRET` | HS256 secret verifying the `vouch_session` cookie — **must exactly match** the `portal` branch's `JWT_SECRET`, or sessions it issues won't verify here. | Yes |
| `SESSION_COOKIE_DOMAIN` | Cookie domain, `.getvouch.club` in deployment, so the cookie is readable cross-subdomain. Unset locally (host-only cookie). | Prod: yes |
| `PORTAL_LOGIN_URL` | Where `middleware.ts` redirects signed-out **page** visitors (server-side default falls back to `https://login.getvouch.club/login` if unset). | No (has fallback) |
| `NEXT_PUBLIC_PORTAL_LOGIN_URL` | Same URL, client-side (used by `/voice`'s logout handler to bounce the browser after clearing the cookie). Inlined at build time. | No (has fallback in code) |
| `NEXT_PUBLIC_DASHBOARD_URL` | Where onboarding ends — `/voice/register` redirects here after enrollment succeeds. Inlined at build time (`NEXT_PUBLIC_*`), so **setting/changing it requires a rebuild**, not just a Vercel settings change (see §9). Unset → success screen stays put, no redirect, no crash. | No |
| `ENCRYPTION_KEY` | Base64, must decode to 32 bytes (`openssl rand -base64 32`) — AES-256-GCM key for `voice_enrollments.embedding`. | Yes |
| `VOICE_SERVICE_URL` | Base URL of the deployed Cloud Run `voice-inference` service (`https://<...>.run.app`). | Yes |
| `VOICE_SERVICE_API_KEY` | Shared secret sent as `X-Api-Key` to the Cloud Run service — **must match** the same-named env var set on the Cloud Run deployment itself. | Yes |
| `GCP_VOICE_CALLER_KEY_BASE64` | Base64-encoded JSON key for the `voice-inference-caller` GCP service account; decoded and used to mint the Google ID token for Cloud Run's IAM check. | Yes |
| `NODE_ENV` | Standard Next.js/Node var; read once in `lib/session-token.ts` to decide the session cookie's `secure` flag (`true` in production). Not set explicitly in `.env.example` — Vercel sets it automatically. | Implicit |

`calling-agent` (sibling branch) separately requires its **own copies** of
`VOICE_SERVICE_URL`, `VOICE_SERVICE_API_KEY`, and
`GCP_VOICE_CALLER_KEY_BASE64` (same values) since branches don't share env
config or code — confirmed via its `lib/calling-agent/voice-match.ts`,
which reads the identical three var names independently.

### Python service (`services/voice-inference`, Cloud Run — set via `gcloud run deploy --set-env-vars` or the Cloud Run console; **no `.env.example` file exists for this service**, so these are documented only in `docs/VOICE.md`'s deploy command and code defaults)

| Variable | Purpose | Default if unset | Set by the documented deploy command? |
|---|---|---|---|
| `VOICE_SERVICE_API_KEY` | Expected value for the `X-Api-Key` header (`require_api_key`); a `500` is raised if this is unset server-side at all. | *(none — required)* | Yes (`docs/VOICE.md`'s `gcloud run deploy` example) |
| `VOICE_MATCH_THRESHOLD` | Cosine-similarity cutoff for `/verify`'s `match` boolean. | `0.5` | **No** — runs on the code default |
| `SPOOF_THRESHOLD` | Cutoff for `/spoof-check`'s `is_spoof` boolean. | `0.5` | **No** — runs on the code default |
| `SPEECHBRAIN_CACHE_DIR` | Where SpeechBrain looks for/caches the ECAPA-TDNN checkpoint. | `/tmp/speechbrain/ecapa` at runtime *if unset*, but the Dockerfile sets it to `/app/pretrained_models/ecapa` at build time and that value persists into the running container (see §6) | N/A — baked via Dockerfile `ENV`, not the deploy command |
| `AASIST_CHECKPOINT_PATH` | Path to the AASIST `.pth` checkpoint. | `<this file's dir>/weights/aasist.pth` (i.e. `app/weights/aasist.pth`) | **No** — runs on the code default, which is correct since that's exactly where the Dockerfile puts it |
| `HF_HUB_OFFLINE` | Disables Hugging Face Hub network calls entirely. | *(unset would allow network calls)* | N/A — hardcoded `ENV HF_HUB_OFFLINE=1` in the Dockerfile itself, not a deploy-time var |
| `PORT` | Which port `uvicorn` binds. | `8080` | Set automatically by Cloud Run at runtime (standard Cloud Run behavior); Dockerfile's `ENV PORT=8080` only matters for local `docker run`. |

**Gap worth flagging:** the `gcloud run deploy` command documented in
`docs/VOICE.md` only passes `--set-env-vars VOICE_SERVICE_API_KEY=...` —
`VOICE_MATCH_THRESHOLD` and `SPOOF_THRESHOLD` are never actually set on
the real deployment despite being fully wired up as configurable env vars
in `main.py`. In practice this means both are just running their `0.5`
code defaults in production; the calibration plan in `docs/VOICE.md`
("query `voice_verifications` for score distributions... pick a threshold
that actually separates them") would need `--update-env-vars
VOICE_MATCH_THRESHOLD=<value>` added to actually change the live
threshold once that analysis is done — currently the only way to change
it would be editing `DEFAULT_MATCH_THRESHOLD` in `main.py` and redeploying.

---

## 9. The onboarding hand-off

The chain is **login → Gmail → bank (skippable) → voice → dashboard**
(root `ARCHITECTURE.md` §1). This branch is the last onboarding step.

`app/voice/register/page.tsx` is the actual hand-off point:

```ts
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL;
const REDIRECT_DELAY_MS = 1400;

useEffect(() => {
  if (!done || !DASHBOARD_URL) return;
  const timer = setTimeout(() => {
    window.location.href = DASHBOARD_URL;
  }, REDIRECT_DELAY_MS);
  return () => clearTimeout(timer);
}, [done]);
```

- `done` flips to `true` only after `POST /api/voice/enroll` returns `ok`
  for all 3 clips (`submitEnroll()`).
- If `NEXT_PUBLIC_DASHBOARD_URL` is set, the success screen ("You're all
  set") holds for `REDIRECT_DELAY_MS` (1.4s) — "long enough to read...
  before the page changes under you" — then does a hard
  `window.location.href` navigation to the dashboard. A manual "Go to
  dashboard" link is also rendered alongside, as a fallback "in case the
  navigation is blocked" (pop-up/nav blockers).
- If unset, the success screen just stays up with "Your voice is
  registered. Setup is complete." and no redirect — enrollment still
  completes and is saved either way; only the hand-off UX is skipped.

**Notable history — the redirect existed but silently never fired.** The
enrollment-only page (`829b4a2`) shipped this logic (or logic like it)
before `NEXT_PUBLIC_DASHBOARD_URL` had any value to read, since the
dashboard branch didn't exist yet. The commit **"Hand off to the dashboard
once voice enrollment completes"** (`acb234e`) explains: the env var was
since set in Vercel, but because `NEXT_PUBLIC_*` values are **inlined at
build time** (root `ARCHITECTURE.md` §9: "changing one requires a
redeploy... not just a settings change"), the already-deployed build
still had it compiled in as unset/empty — so onboarding kept silently
dead-ending on the static screen even after the Vercel dashboard showed
the var configured. That commit's actual code diff (`.env.example` +2
lines documenting the var, `app/voice/register/page.tsx` +21/−6 adding
the delay/timer/fallback link) is what both **fixed the redirect logic**
*and*, just by being a new commit, **triggered the rebuild** needed to
pick the already-set var up. Worth remembering as a general gotcha on
this stack: setting a `NEXT_PUBLIC_*` var in Vercel does nothing to
already-built deployments until the next build.

---

## 10. Known limitations

Confirmed present in this branch's own code/docs, plus a few observed
directly in code beyond what `docs/VOICE.md` states:

1. **Anti-spoofing (AASIST) is advisory only, not blocking** — confirmed
   independently in both `app/api/voice/enroll/route.ts` and
   `app/api/voice/verify/route.ts` (§3, §5): the spoof result is always
   computed and logged/returned, never gates success. Root cause per
   `docs/VOICE.md`: AASIST was trained on clean ASVspoof2019 **studio**
   recordings; real browser-mic audio (webm/opus, echo cancellation,
   resampling) is enough of a channel mismatch that it produced false
   positives on genuine speech during testing ("real enrollment attempts
   were getting rejected as 'synthetic'"). `docs/VOICE.md` lays out the
   fix path (collect real `spoof_score` values from the enroll/verify
   `console.log` lines, across bonafide vs. actual spoof attempts,
   re-threshold or fine-tune) but that work has not started.
2. **Speaker-match threshold (`0.5`) is a rough guess, not a calibrated
   value** — moved down from an even rougher `0.75` after one real
   same-speaker test scored 66.9%; still "not calibrated against real
   negative/different-speaker trials." No genuine impostor trial is known
   to have been run against this checkpoint yet.
3. **Live speaker-matching on phone calls is post-call, not real-time** —
   this is true of `calling-agent`'s consumption of this service
   (`detectHuman()` needs the full Vapi recording URL, which is only
   available after the call ends), matching root `ARCHITECTURE.md` §7
   verbatim. It is worth being precise that this limitation is about
   **`calling-agent`'s use case**, not this branch's own Live Monitor
   feature — `/voice`'s Live Monitor *does* run continuously in the
   browser during an active session, re-verifying every ~4.5s. What
   remains genuinely real-time-*capable*-but-unbuilt, per root
   `ARCHITECTURE.md` §7, is wiring that same continuous approach into an
   actual phone call: Vapi exposes a live PCM WebSocket
   (`monitor.listenUrl`) and mid-call speech injection (`controlUrl`),
   but that needs an always-on listener process, which Vercel's
   request-scoped functions can't host — it "would live next to the
   Cloud Run inference service" if built.
4. **Raw score volatility is inherent to this checkpoint on this audio
   pipeline, not fully solved by the mitigations in place.** Even with
   4.5s windows and VAD trimming, `docs/VOICE.md` and
   `lib/use-live-monitor.ts`'s own comments say same-speaker scores still
   ranged 0.09–0.61 within one session. Rolling-average smoothing and
   asymmetric recovery (§4) make the **UI** more stable, but they smooth
   over the underlying signal rather than fixing it — the checkpoint is
   "not fine-tuned or score-normalized" for this deployment's audio
   pipeline at all.
5. **No re-enrollment history / versioning.** `voice_enrollments` has
   `user_id` as its primary key — re-enrolling overwrites the prior
   embedding outright (`on conflict... do update`). There is no way to
   recover a previous enrollment or audit when/why it changed beyond the
   single `updated_at` timestamp.
6. **`ENCRYPTION_KEY` has no rotation story.** Changing it orphans every
   previously stored `voice_enrollments.embedding` (it would fail to
   decrypt) with no migration tooling to re-encrypt under a new key.
7. **`X-Api-Key` comparison is a plain `!=` string check**, not
   constant-time — a theoretical timing-attack surface on the app-level
   key, though the IAM layer in front of it is the actual access boundary.
8. **The threshold env vars are wired but not actually deployed** — see
   the gap noted in §8: `VOICE_MATCH_THRESHOLD`/`SPOOF_THRESHOLD` are
   fully configurable in code but the documented `gcloud run deploy`
   command never sets them, so production silently runs the `0.5`/`0.5`
   code defaults rather than any deliberately-chosen value.
9. **Fine-tuning is explicitly out of scope for this iteration** —
   `docs/VOICE.md`'s "Fine-tuning roadmap" section lists dataset access
   (VoxCeleb/ASVspoof licensing, not yet registered), GPU compute (an
   A100 quota confirmed available in `patchguard-reakon`/`us-central1` but
   not provisioned), and an actual training pipeline as three separate,
   later, cost-incurring decisions — both models in production today are
   frozen pretrained checkpoints used purely as feature extractors.
10. **No automated tests found in this branch** — no test files
    accompany either the Next.js routes/hooks or the Python service;
    correctness has been validated through the manual/logged real-world
    testing narrated in the commit messages and `docs/VOICE.md`, not a
    test suite.
