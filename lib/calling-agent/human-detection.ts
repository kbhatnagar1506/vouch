/**
 * Pluggable seam for a human-vs-not-human verdict on a call — e.g. "is a
 * live person on the line, not voicemail, an IVR, or a synthetic/replayed
 * voice." Intentionally NOT a real implementation: the real model is being
 * attached later. Every caller (the webhook handler, the UI) goes through
 * `detectHuman()` so wiring in the real thing later is a one-function change.
 *
 * The most likely real implementation is already in this repo: the
 * voice-verification branch ships an anti-spoofing model (AASIST, served by
 * services/voice-inference's /spoof-check — see that branch's docs/VOICE.md)
 * built for exactly this "live human vs. clone/replay" question. Once a
 * call recording is available (`recordingUrl` below, from the
 * end-of-call-report), pointing this function at that service is the
 * natural next step rather than building a new model from scratch.
 */

export interface HumanDetectionInput {
  callId: string;
  /**
   * Vapi's own built-in voicemail-detection verdict, when the assistant has
   * it enabled (see lib/calling-agent/assistant.ts). This is a voicemail/IVR
   * classifier, not a liveness or anti-spoofing check — used below only as
   * an interim signal until a real model is wired in.
   */
  vapiVoicemailDetected?: boolean;
  /** Call recording URL, once available (end-of-call-report artifact). */
  recordingUrl?: string | null;
  transcript?: string | null;
}

export interface HumanDetectionResult {
  /** null means "not evaluated", not "evaluated as unclear". */
  isHuman: boolean | null;
  confidence: number | null;
  source: "vapi-voicemail-detection" | "unimplemented";
  reason?: string;
}

export async function detectHuman(input: HumanDetectionInput): Promise<HumanDetectionResult> {
  if (input.vapiVoicemailDetected != null) {
    return {
      isHuman: !input.vapiVoicemailDetected,
      confidence: null,
      source: "vapi-voicemail-detection",
      reason: input.vapiVoicemailDetected
        ? "Vapi's built-in voicemail detection flagged this call as voicemail/an answering machine."
        : "Vapi's built-in voicemail detection did not flag voicemail. This is not a liveness/anti-spoofing check.",
    };
  }
  return { isHuman: null, confidence: null, source: "unimplemented" };
}
