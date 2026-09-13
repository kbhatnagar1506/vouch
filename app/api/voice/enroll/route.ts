import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { pool } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { embedAudio, checkSpoof } from "@/lib/voice-service";

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return NextResponse.json({ error: "Missing audio sample" }, { status: 400 });
    }

    // AASIST was trained on clean ASVspoof2019 studio recordings, not
    // compressed browser-mic audio (webm/opus, echo cancellation, etc.) —
    // that channel mismatch is producing false positives on real speech
    // (see docs/VOICE.md "Anti-spoofing — what's left"). Advisory only for
    // now: logged for calibration, not blocking, until validated against
    // real enrollment/verify recordings rather than a synthetic test tone.
    const spoof = await checkSpoof(audio);
    console.log("[voice/enroll] spoof-check", {
      userId: user.id,
      model_loaded: spoof.model_loaded,
      spoof_score: spoof.spoof_score,
      is_spoof: spoof.is_spoof,
    });

    const { embedding, model_version } = await embedAudio(audio);
    const encrypted = encryptSecret(JSON.stringify(embedding));

    await pool.query(
      `insert into voice_enrollments (user_id, embedding, model_version, updated_at)
       values ($1, $2, $3, now())
       on conflict (user_id) do update
         set embedding = excluded.embedding,
             model_version = excluded.model_version,
             updated_at = now()`,
      [user.id, encrypted, model_version],
    );

    return NextResponse.json({ ok: true, model_version });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Enrollment failed" },
      { status: 500 },
    );
  }
}
