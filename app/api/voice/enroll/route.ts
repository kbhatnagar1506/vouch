import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { pool } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { embedAudio, checkSpoof, NoSpeechError } from "@/lib/voice-service";

/** Elementwise mean of several embeddings — a centroid enrollment is less
 * sensitive to any single recording being atypical or noisy than storing
 * just one clip's embedding. */
function averageEmbeddings(embeddings: number[][]): number[] {
  const dim = embeddings[0].length;
  const sum = new Array(dim).fill(0);
  for (const embedding of embeddings) {
    for (let i = 0; i < dim; i++) sum[i] += embedding[i];
  }
  return sum.map((value) => value / embeddings.length);
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();

    const form = await request.formData();
    const clips = form.getAll("audio").filter((f): f is File => f instanceof Blob && f.size > 0);
    if (clips.length === 0) {
      return NextResponse.json({ error: "Missing audio sample" }, { status: 400 });
    }

    const embeddings: number[][] = [];
    let modelVersion = "";

    for (let i = 0; i < clips.length; i++) {
      const audio = clips[i];

      // AASIST was trained on clean ASVspoof2019 studio recordings, not
      // compressed browser-mic audio (webm/opus, echo cancellation, etc.) —
      // that channel mismatch is producing false positives on real speech
      // (see docs/VOICE.md "Anti-spoofing — what's left"). Advisory only for
      // now: logged for calibration, not blocking, until validated against
      // real enrollment/verify recordings rather than a synthetic test tone.
      const spoof = await checkSpoof(audio);
      console.log("[voice/enroll] spoof-check", {
        userId: user.id,
        clip: i,
        model_loaded: spoof.model_loaded,
        spoof_score: spoof.spoof_score,
        is_spoof: spoof.is_spoof,
      });

      let embedResult;
      try {
        embedResult = await embedAudio(audio);
      } catch (error) {
        if (error instanceof NoSpeechError) {
          return NextResponse.json(
            { error: `No speech detected in recording ${i + 1} of ${clips.length}. Please re-record it.` },
            { status: 422 },
          );
        }
        throw error;
      }
      embeddings.push(embedResult.embedding);
      modelVersion = embedResult.model_version;
    }

    const averaged = embeddings.length > 1 ? averageEmbeddings(embeddings) : embeddings[0];
    const encrypted = encryptSecret(JSON.stringify(averaged));

    await pool.query(
      `insert into voice_enrollments (user_id, embedding, model_version, updated_at)
       values ($1, $2, $3, now())
       on conflict (user_id) do update
         set embedding = excluded.embedding,
             model_version = excluded.model_version,
             updated_at = now()`,
      [user.id, encrypted, modelVersion],
    );

    return NextResponse.json({ ok: true, model_version: modelVersion, samples: embeddings.length });
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
