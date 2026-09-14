import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { fetchInquiry, getIdentity, saveIdentity } from "@/lib/persona";
import { agentTier, isTerminal, isVerified } from "@/lib/persona-schema";

// The authoritative answer to "what is this user allowed to have the agent
// do?" — read by the dashboard and by card-issuing before a mint.
//
// Reconciles with Persona on read when the stored status isn't terminal.
// Webhooks are the primary path, but they can be delayed, dropped, or
// (during local dev) not reach us at all, and a user staring at a spinner
// after finishing the flow is the worst failure mode here. Terminal
// statuses are never re-fetched — they can't change, and each call is
// latency we'd be adding to every dashboard load for nothing.
export async function GET() {
  try {
    const user = await requireUser();
    let identity = await getIdentity(user.id);

    if (identity && !isTerminal(identity.status)) {
      try {
        const fresh = await fetchInquiry(identity.inquiryId);
        if (fresh && fresh.status !== identity.status) {
          await saveIdentity(user.id, fresh);
          identity = await getIdentity(user.id);
        }
      } catch {
        // Persona unreachable — fall through with what we have. An outage
        // there must degrade the agent to observe-only, never 500 the
        // dashboard.
      }
    }

    const status = identity?.status ?? null;
    return NextResponse.json({
      status,
      verified: isVerified(status),
      tier: agentTier(status),
      isOver18: identity?.isOver18 ?? null,
      phoneVerified: identity?.phoneVerified ?? false,
      name: identity?.nameFirst ? `${identity.nameFirst} ${identity.nameLast ?? ""}`.trim() : null,
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read verification status" },
      { status: 500 },
    );
  }
}
