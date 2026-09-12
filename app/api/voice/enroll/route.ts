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

    // Reject enrollment outright on a sample that looks synthetic — no
    // point locking in a reference embedding built from a spoofed voice.
    const spoof = await checkSpoof(audio);
    if (spoof.model_loaded && spoof.is_spoof) {
      return NextResponse.json(
        { error: "This sample looks synthetic or replayed. Please re-record live." },
        { status: 422 },
      );
    }

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
