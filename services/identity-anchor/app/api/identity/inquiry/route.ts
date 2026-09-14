import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { createInquiry, getIdentity, isConfigured, saveIdentity } from "@/lib/persona";
import { isVerified } from "@/lib/persona-schema";

// Starts a verification: creates the Persona inquiry server-side and hands
// the browser only an inquiry id + session token for the embedded widget to
// open. See lib/persona.ts's createInquiry() for why the client is never
// allowed to create one from a template id itself.
export async function POST() {
  try {
    const user = await requireUser();

    if (!isConfigured()) {
      return NextResponse.json(
        { error: "Identity verification is not configured. See docs/IDENTITY.md." },
        { status: 501 },
      );
    }

    // Already verified — don't burn another Persona service (they're billed
    // per verification) or make the user redo it.
    const existing = await getIdentity(user.id);
    if (existing && isVerified(existing.status)) {
      return NextResponse.json({ alreadyVerified: true, status: existing.status });
    }

    const { inquiryId, sessionToken } = await createInquiry(user.id);

    // Persist immediately, before the user starts the flow: the webhook
    // arrives with only an inquiry id and no session, so this row is what
    // lets us map it back to a user. Writing it after the flow would lose
    // any verification the user completes faster than we record it.
    await saveIdentity(user.id, {
      inquiryId,
      accountId: null,
      status: "created",
      nameFirst: null,
      nameLast: null,
      addressStreet1: null,
      addressStreet2: null,
      addressCity: null,
      addressSubdivision: null,
      addressPostalCode: null,
      addressCountryCode: null,
      isOver18: null,
      phoneVerified: false,
      selfieLivenessPassed: null,
      selfieDocumentSimilarity: null,
    });

    return NextResponse.json({
      inquiryId,
      sessionToken,
      environmentId: process.env.NEXT_PUBLIC_PERSONA_ENVIRONMENT_ID ?? null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to start verification" },
      { status: 500 },
    );
  }
}
