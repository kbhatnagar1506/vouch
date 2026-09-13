import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { pool } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { verifyAudio, checkSpoof } from "@/lib/voice-service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "Missing audio sample" }, { status: 400 });
    }

    const { rows } = await pool.query<{ embedding: string }>(
      "select embedding from voice_enrollments where user_id = $1",
      [user.id],
    );
    const enrollment = rows[0];
    if (!enrollment) {
      return NextResponse.json({ error: "No voice enrollment on file for this user" }, { status: 404 });
    }
    const referenceEmbedding: number[] = JSON.parse(decryptSecret(enrollment.embedding));

    const [speaker, spoof] = await Promise.all([
      verifyAudio(audio, referenceEmbedding),
      checkSpoof(audio),
    ]);

    const spoofed = spoof.model_loaded && spoof.is_spoof;
    // Advisory only for now, not gating — see the enroll route for why
    // (AASIST channel mismatch on browser-mic audio, needs calibration).
    const passed = speaker.match;
    console.log("[voice/verify] spoof-check", {
      userId: user.id,
      model_loaded: spoof.model_loaded,
      spoof_score: spoof.spoof_score,
      is_spoof: spoof.is_spoof,
      speaker_score: speaker.score,
    });

    await pool.query(
      `insert into voice_verifications (user_id, speaker_score, spoof_score, passed)
       values ($1, $2, $3, $4)`,
      [user.id, speaker.score, spoof.model_loaded ? spoof.spoof_score : null, passed],
    );

    return NextResponse.json({
      passed,
      speaker: { score: speaker.score, threshold: speaker.threshold, match: speaker.match },
      spoof: { score: spoof.model_loaded ? spoof.spoof_score : null, is_spoof: spoofed, model_loaded: spoof.model_loaded },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Verification failed" },
      { status: 500 },
    );
  }
}
