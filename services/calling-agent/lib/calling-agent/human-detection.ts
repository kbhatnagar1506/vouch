/**
 * Verdict on who (or what) was actually on the other end of a call.
 * Two questions, not one:
 *   - isHuman: is a live person on the line at all (not voicemail/an IVR)?
 *   - isAccountOwner: if a human, is it specifically the enrolled Vouch
 *     user's voice? This is the one that matters for purchase_verification
 *     calls -- confirming a $40 charge means nothing if it's confirmed by
 *     whoever happens to answer the phone, not the cardholder.
 *
 * isAccountOwner uses voice-verification's real speaker-matching model
 * (ECAPA-TDNN embeddings, via services/voice-inference's /verify) against
 * that user's voice_enrollments row -- not a new model built here. Every
 * caller (the webhook handler, the UI) goes through detectHuman(), so this
 * was a one-function change once voice-verification's enrollment existed.
 *
 * Deliberately NOT using voice-verification's anti-spoofing model
 * (/spoof-check, AASIST) here: that answers "is this a live human vs. a
 * replay/clone," which matters for its own voice-auth use case, but a
 * phone call already goes through Vapi's own voicemail detection for the
 * "is anyone really there" question -- what's missing for purchase
 * verification specifically is identity, which speaker-matching answers
 * directly.
 */
import { pool } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { verifyAudio } from "@/lib/calling-agent/voice-match";

export interface HumanDetectionInput {
  callId: string;
  /** The Vouch user this call was placed for, if known -- needed to look up their voice enrollment. */
  userId?: string | null;
  /**
   * Vapi's own built-in voicemail-detection verdict, when the assistant has
   * it enabled (see lib/calling-agent/assistant.ts). This is a voicemail/IVR
   * classifier, not a liveness or identity check -- used below only as an
   * interim signal for isHuman, and to skip the speaker-match call entirely
   * when nobody real was on the line.
   */
  vapiVoicemailDetected?: boolean;
  /** Call recording URL, once available (end-of-call-report artifact). */
  recordingUrl?: string | null;
  transcript?: string | null;
}

export interface HumanDetectionResult {
  /** null means "not evaluated", not "evaluated as unclear". */
  isHuman: boolean | null;
  /** null when isHuman isn't true, or no enrollment/recording was available to check against. */
  isAccountOwner: boolean | null;
  /** Raw cosine-similarity score from voice-verification's speaker model, when isAccountOwner was actually evaluated. */
  speakerScore: number | null;
  source: "vapi-voicemail-detection" | "speaker-match" | "speaker-match-error" | "no-enrollment" | "unimplemented";
  reason?: string;
}

async function getEnrolledEmbedding(userId: string): Promise<number[] | null> {
  const { rows } = await pool.query<{ embedding: string }>(
    "select embedding from voice_enrollments where user_id = $1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return JSON.parse(decryptSecret(row.embedding));
}

export async function detectHuman(input: HumanDetectionInput): Promise<HumanDetectionResult> {
  if (input.vapiVoicemailDetected === true) {
    return {
      isHuman: false,
      isAccountOwner: null,
      speakerScore: null,
      source: "vapi-voicemail-detection",
      reason: "Vapi's built-in voicemail detection flagged this call as voicemail/an answering machine.",
    };
  }
  // Vapi explicitly said "not voicemail" -> a real starting signal for
  // isHuman even before any speaker-match runs; undefined means Vapi's
  // voicemail detection wasn't enabled/reported for this call at all.
  const baselineIsHuman = input.vapiVoicemailDetected === false ? true : null;

  if (!input.recordingUrl || !input.userId) {
    return { isHuman: baselineIsHuman, isAccountOwner: null, speakerScore: null, source: "unimplemented" };
  }

  try {
    const embedding = await getEnrolledEmbedding(input.userId);
    if (!embedding) {
      return {
        isHuman: true,
        isAccountOwner: null,
        speakerScore: null,
        source: "no-enrollment",
        reason: "This user has no voice enrollment on file (voice-verification's voice_enrollments) to match against.",
      };
    }

    const audioRes = await fetch(input.recordingUrl);
    if (!audioRes.ok) {
      throw new Error(`Failed to fetch call recording (${audioRes.status})`);
    }
    const audioBlob = await audioRes.blob();

    const result = await verifyAudio(audioBlob, embedding);
    return {
      isHuman: true,
      isAccountOwner: result.match,
      speakerScore: result.score,
      source: "speaker-match",
      reason: result.match
        ? `Recording matched the enrolled voiceprint (score ${result.score.toFixed(3)} >= threshold ${result.threshold}).`
        : `Recording did not match the enrolled voiceprint (score ${result.score.toFixed(3)} < threshold ${result.threshold}).`,
    };
  } catch (error) {
    console.error("detectHuman speaker-match failed:", error);
    return {
      isHuman: baselineIsHuman ?? true,
      isAccountOwner: null,
      speakerScore: null,
      source: "speaker-match-error",
      reason: error instanceof Error ? error.message : "Speaker-match check failed.",
    };
  }
}
