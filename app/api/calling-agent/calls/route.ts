import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { getVapiClient } from "@/lib/vapi";
import { callOverrides, DEFAULT_INTAKE_FIELDS, DEFAULT_PURPOSE, type IntakeField } from "@/lib/calling-agent/assistant";
import { insertCall, attachVapiCall, markCallFailed, listCallsForUser } from "@/lib/calling-agent/calls";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/CALLING_AGENT.md for setup.`);
  }
  return value;
}

/** Best-effort: user_profiles is owned by the portal branch and may not exist on every DB yet. */
async function defaultPhoneNumber(userId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ phone_number: string }>("select phone_number from user_profiles where user_id = $1", [
      userId,
    ]);
    return rows[0]?.phone_number ?? null;
  } catch {
    return null;
  }
}

interface CreateCallBody {
  toNumber?: string;
  purpose?: string;
  fields?: IntakeField[];
  /** Free-text detail for this one call — e.g. the transaction being verified. See CallOverridesOptions.context. */
  context?: string;
}

// Places an outbound call via Vapi on behalf of the current user — e.g. to
// collect/confirm onboarding details (DEFAULT_PURPOSE), or to verify a
// specific purchase (PURCHASE_VERIFICATION_PURPOSE, with the transaction
// details passed as `context`). Custom purpose/fields work for anything else.
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as CreateCallBody;

    const toNumber = body.toNumber || (await defaultPhoneNumber(user.id));
    if (!toNumber) {
      return NextResponse.json(
        { error: "toNumber is required (no phone number on file for this user either)" },
        { status: 400 },
      );
    }
    const purpose = body.purpose || DEFAULT_PURPOSE;
    const fields = body.fields?.length ? body.fields : DEFAULT_INTAKE_FIELDS;
    const context = body.context || null;

    const call = await insertCall({ userId: user.id, toNumber, purpose, fields, context });

    try {
      const response = await getVapiClient().calls.create({
        assistantId: requiredEnv("VAPI_ASSISTANT_ID"),
        phoneNumberId: requiredEnv("VAPI_PHONE_NUMBER_ID"),
        customer: { number: toNumber, name: user.name || undefined },
        assistantOverrides: callOverrides({ purpose, fields, customerName: user.name, context }),
      });

      // A single `customer` (not `customers`) always gets back a single Call, never CallBatchResponse.
      if (!("id" in response)) {
        throw new Error("Unexpected batch response from Vapi for a single-customer call.");
      }

      await attachVapiCall(call.id, response.id, response.assistantId ?? null, response.status ?? "queued", response);
      return NextResponse.json(
        { call: { ...call, vapiCallId: response.id, status: response.status ?? "queued" } },
        { status: 201 },
      );
    } catch (vapiError) {
      const message = vapiError instanceof Error ? vapiError.message : "Failed to create call via Vapi";
      await markCallFailed(call.id, message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to create call" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const calls = await listCallsForUser(user.id);
    return NextResponse.json({ calls });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to list calls" }, { status: 500 });
  }
}
