import { NextResponse } from "next/server";
import { verifyWebhookSecret } from "@/lib/calling-agent/webhook-auth";
import { recordEvent, updateCallFromWebhook, getCallByVapiId } from "@/lib/calling-agent/calls";
import { detectHuman } from "@/lib/calling-agent/human-detection";

// Loosely typed on purpose: Vapi's ServerMessage union has ~20 variants and
// changes over time. We only read the handful of fields each case below
// actually needs, same spirit as lib/plaid-webhook's hand-rolled body type.
interface VapiServerMessage {
  type: string;
  call?: { id?: string; assistantId?: string };
  status?: string;
  endedReason?: string;
  artifact?: { transcript?: string; recordingUrl?: string };
  analysis?: { structuredData?: unknown };
  [key: string]: unknown;
}

// Vapi's Server URL endpoint. Registered via lib/calling-agent/assistant.ts
// (assistant.server.url) when the assistant is synced — see
// scripts/calling-agent/sync-assistant.ts and docs/CALLING_AGENT.md.
export async function POST(request: Request) {
  if (!verifyWebhookSecret(request)) {
    return NextResponse.json({ error: "Invalid webhook secret" }, { status: 401 });
  }

  const body = (await request.json()) as { message: VapiServerMessage };
  const message = body.message;
  const vapiCallId = message.call?.id;

  // Nothing to correlate this to — ack anyway so Vapi doesn't retry forever.
  if (!vapiCallId) {
    return NextResponse.json({ ok: true });
  }

  try {
    const existing = await getCallByVapiId(vapiCallId);
    await recordEvent({ callId: existing?.id ?? null, vapiCallId, eventType: message.type, payload: message });

    switch (message.type) {
      case "status-update": {
        await updateCallFromWebhook(vapiCallId, { status: message.status, raw: message });
        break;
      }
      case "end-of-call-report": {
        const humanDetection = await detectHuman({
          callId: vapiCallId,
          recordingUrl: message.artifact?.recordingUrl ?? null,
          transcript: message.artifact?.transcript ?? null,
          vapiVoicemailDetected: message.endedReason === "voicemail",
        });
        await updateCallFromWebhook(vapiCallId, {
          status: "ended",
          endedReason: message.endedReason ?? null,
          transcript: message.artifact?.transcript ?? null,
          recordingUrl: message.artifact?.recordingUrl ?? null,
          structuredData: message.analysis?.structuredData ?? null,
          humanDetection,
          raw: message,
        });
        break;
      }
      default:
        // Every other message type (transcript, speech-update, …) is just
        // logged via recordEvent above — nothing else to do with it yet.
        break;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook handling failed" },
      { status: 500 },
    );
  }
}
