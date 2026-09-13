// Server-side client for the voice-inference Cloud Run service
// (services/voice-inference) — a separate Python/FastAPI deployment, not
// something Next.js/Vercel can run natively. See docs/VOICE.md.
//
// Two layers of auth on every call: Cloud Run's own IAM invoker check
// (only the voice-inference-caller service account may reach the service
// at all — enforced via a Google-signed ID token in `Authorization`), and
// this app's own VOICE_SERVICE_API_KEY (sent as `X-Api-Key`, a separate
// header so it doesn't collide with the IAM token) as defense-in-depth.
import { GoogleAuth } from "google-auth-library";

declare global {
  // eslint-disable-next-line no-var
  var _voiceServiceAuth: GoogleAuth | undefined;
}

function getAuth(): GoogleAuth {
  if (!global._voiceServiceAuth) {
    const encoded = process.env.GCP_VOICE_CALLER_KEY_BASE64;
    if (!encoded) {
      throw new Error("GCP_VOICE_CALLER_KEY_BASE64 is not set. See docs/VOICE.md.");
    }
    const credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    global._voiceServiceAuth = new GoogleAuth({ credentials });
  }
  return global._voiceServiceAuth;
}

function getServiceUrl(): string {
  const url = process.env.VOICE_SERVICE_URL;
  if (!url) {
    throw new Error("VOICE_SERVICE_URL is not set. See docs/VOICE.md.");
  }
  return url.replace(/\/$/, "");
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const apiKey = process.env.VOICE_SERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("VOICE_SERVICE_API_KEY is not set. See docs/VOICE.md.");
  }
  const client = await getAuth().getIdTokenClient(getServiceUrl());
  const idTokenHeaders = await client.getRequestHeaders();
  return { ...idTokenHeaders, "X-Api-Key": apiKey };
}

export interface EmbedResult {
  embedding: number[];
  model_version: string;
  duration_seconds: number;
}

export interface VerifyResult {
  score: number;
  match: boolean;
  threshold: number;
}

export interface SpoofCheckResult {
  spoof_score: number;
  is_spoof: boolean;
  model_loaded: boolean;
}

/** The upload didn't contain any detectable speech (Silero VAD found nothing) — not a real error, callers should treat it like silence. */
export class NoSpeechError extends Error {
  constructor() {
    super("No speech detected in this audio.");
    this.name = "NoSpeechError";
  }
}

async function postAudio<T>(path: string, audio: Blob, extraFields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("audio", audio, "sample.webm");
  for (const [key, value] of Object.entries(extraFields)) {
    form.set(key, value);
  }

  const res = await fetch(`${getServiceUrl()}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 422 && text.includes("no_speech_detected")) {
      throw new NoSpeechError();
    }
    throw new Error(`Voice service ${path} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Extracts a speaker embedding from an audio sample (pretrained ECAPA-TDNN). */
export function embedAudio(audio: Blob): Promise<EmbedResult> {
  return postAudio<EmbedResult>("/embed", audio);
}

/** Compares an audio sample against a previously-enrolled embedding. */
export function verifyAudio(audio: Blob, referenceEmbedding: number[]): Promise<VerifyResult> {
  return postAudio<VerifyResult>("/verify", audio, {
    reference_embedding: JSON.stringify(referenceEmbedding),
  });
}

/** Checks whether an audio sample looks synthetic/replayed rather than a live human voice. */
export function checkSpoof(audio: Blob): Promise<SpoofCheckResult> {
  return postAudio<SpoofCheckResult>("/spoof-check", audio);
}
