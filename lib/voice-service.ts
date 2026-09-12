// Server-side client for the voice-inference Cloud Run service
// (services/voice-inference) — a separate Python/FastAPI deployment, not
// something Next.js/Vercel can run natively. See docs/VOICE.md.

function getServiceUrl(): string {
  const url = process.env.VOICE_SERVICE_URL;
  if (!url) {
    throw new Error("VOICE_SERVICE_URL is not set. See docs/VOICE.md.");
  }
  return url.replace(/\/$/, "");
}

function getServiceHeaders(): HeadersInit {
  const apiKey = process.env.VOICE_SERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("VOICE_SERVICE_API_KEY is not set. See docs/VOICE.md.");
  }
  return { Authorization: `Bearer ${apiKey}` };
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

async function postAudio<T>(path: string, audio: Blob, extraFields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set("audio", audio, "sample.webm");
  for (const [key, value] of Object.entries(extraFields)) {
    form.set(key, value);
  }

  const res = await fetch(`${getServiceUrl()}${path}`, {
    method: "POST",
    headers: getServiceHeaders(),
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
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
