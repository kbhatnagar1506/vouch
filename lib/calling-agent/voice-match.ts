// Server-side client for voice-verification's voice-inference Cloud Run
// service -- trimmed to just /verify (speaker-match against an enrolled
// embedding), the only endpoint human-detection.ts needs. Ported from
// voice-verification's lib/voice-service.ts rather than shared across
// branches (see root CLAUDE.md); /embed and /spoof-check aren't needed
// here since this branch never enrolls anyone, only checks an existing
// enrollment against a call recording.
import { GoogleAuth } from "google-auth-library";

declare global {
  // eslint-disable-next-line no-var
  var _voiceServiceAuth: GoogleAuth | undefined;
}

function getAuth(): GoogleAuth {
  if (!global._voiceServiceAuth) {
    const encoded = process.env.GCP_VOICE_CALLER_KEY_BASE64;
    if (!encoded) {
      throw new Error("GCP_VOICE_CALLER_KEY_BASE64 is not set. See voice-verification's docs/VOICE.md.");
    }
    const credentials = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    global._voiceServiceAuth = new GoogleAuth({ credentials });
  }
  return global._voiceServiceAuth;
}

function getServiceUrl(): string {
  const url = process.env.VOICE_SERVICE_URL;
  if (!url) {
    throw new Error("VOICE_SERVICE_URL is not set. See voice-verification's docs/VOICE.md.");
  }
  return url.replace(/\/$/, "");
}

export interface VerifyResult {
  score: number;
  match: boolean;
  threshold: number;
}

/** Compares an audio sample against a previously-enrolled speaker embedding. */
export async function verifyAudio(audio: Blob, referenceEmbedding: number[]): Promise<VerifyResult> {
  const apiKey = process.env.VOICE_SERVICE_API_KEY;
  if (!apiKey) {
    throw new Error("VOICE_SERVICE_API_KEY is not set. See voice-verification's docs/VOICE.md.");
  }

  const form = new FormData();
  form.set("audio", audio, "recording.wav");
  form.set("reference_embedding", JSON.stringify(referenceEmbedding));

  const client = await getAuth().getIdTokenClient(getServiceUrl());
  const idTokenHeaders = await client.getRequestHeaders();

  const res = await fetch(`${getServiceUrl()}/verify`, {
    method: "POST",
    headers: { ...idTokenHeaders, "X-Api-Key": apiKey },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Voice service /verify failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<VerifyResult>;
}
