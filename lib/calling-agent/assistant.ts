import type { Vapi } from "@vapi-ai/server-sdk";
import { WEBHOOK_SECRET_HEADER } from "@/lib/calling-agent/webhook-auth";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/CALLING_AGENT.md for setup.`);
  }
  return value;
}

// The one assistant this branch manages, upserted by name (see
// scripts/calling-agent/sync-assistant.ts) rather than a separate
// assistant per call purpose — per-call differences (what to ask about,
// who we're calling) are passed as `assistantOverrides` on the call itself
// (see callOverrides() below), not baked into the saved assistant.
export const ASSISTANT_NAME = "vouch-calling-agent";

export interface IntakeField {
  key: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean";
}

export const DEFAULT_PURPOSE = "onboarding_profile";

// Mirrors the portal branch's `user_profiles` table
// (migrations/003_create_user_profiles.sql) — the calling agent's default
// job is confirming/collecting exactly these onboarding fields by phone.
// POST /api/calling-agent/calls can pass its own `purpose` + `fields` for
// a different kind of call entirely; this is just the out-of-the-box one.
export const DEFAULT_INTAKE_FIELDS: IntakeField[] = [
  { key: "age", label: "Age", description: "The customer's age in years.", type: "number" },
  {
    key: "phone_number",
    label: "Phone number",
    description: "A good callback number for the customer, in E.164 format if possible.",
    type: "string",
  },
  { key: "address_street", label: "Street address", description: "Street address, including house/unit number.", type: "string" },
  { key: "address_city", label: "City", description: "City of residence.", type: "string" },
  { key: "address_state", label: "State", description: "State of residence (2-letter code for US addresses).", type: "string" },
  { key: "address_zip", label: "ZIP / postal code", description: "Postal code of residence.", type: "string" },
  {
    key: "employment_status",
    label: "Employment status",
    description: "e.g. employed, self-employed, student, unemployed, retired.",
    type: "string",
  },
  { key: "income_range", label: "Income range", description: "Approximate annual income range, in the customer's own words.", type: "string" },
  { key: "financial_goal", label: "Financial goal", description: "What the customer is trying to achieve on Vouch.", type: "string" },
];

export const PURCHASE_VERIFICATION_PURPOSE = "purchase_verification";

// A second preset: confirming a specific purchase/transaction with the
// cardholder before (or right after) it goes through — the phone-call
// equivalent of a bank's "did you just try to spend $X at Y?" fraud check.
// Pass the actual transaction details (merchant, amount, card) as `context`
// on the call (see CallOverridesOptions) — these fields just capture the
// verdict, not the transaction itself.
export const PURCHASE_VERIFICATION_FIELDS: IntakeField[] = [
  {
    key: "confirmed",
    label: "Confirmed",
    description: "true if the customer confirms they personally authorized this specific purchase, false if they say they did not.",
    type: "boolean",
  },
  {
    key: "concern_reason",
    label: "Concern reason",
    description:
      "If not confirmed, or the customer sounds unsure/concerned, a brief note why (e.g. 'doesn't recognize merchant', 'says card was lost'). Empty string if confirmed with no concerns.",
    type: "string",
  },
];

export function intakeSchema(fields: IntakeField[]): Vapi.JsonSchema {
  return {
    type: "object",
    properties: Object.fromEntries(
      fields.map((f): [string, Vapi.JsonSchema] => [f.key, { type: f.type, description: f.description }]),
    ),
    required: fields.map((f) => f.key),
  };
}

// Spoken immediately on connect (firstMessageMode: "assistant-speaks-first"
// below) rather than left for the model to generate on its first turn —
// without this, the call opens in silence until the model produces a
// response, which reads as dead air and gets hung up on.
function buildFirstMessage(purpose: string, customerName?: string | null): string {
  const name = customerName || "there";
  if (purpose === PURCHASE_VERIFICATION_PURPOSE) {
    return `Hi ${name}, this is Vouch calling to quickly verify a recent purchase on your account — do you have a minute?`;
  }
  return `Hi ${name}, this is Vouch calling to follow up on your account setup — do you have a minute?`;
}

function buildSystemPrompt(purpose: string, fields: IntakeField[], customerName?: string | null, context?: string | null): string {
  const fieldLines = fields.map((f) => `- ${f.label}: ${f.description}`).join("\n");
  return [
    `You are Vouch's calling agent, phoning ${customerName || "a Vouch user"} on behalf of the Vouch platform.`,
    `Start by introducing yourself by name and company, and confirm you're speaking with the right person before asking anything else.`,
    context ? `Specific context for this call: ${context}` : null,
    `Your job for this call (purpose: "${purpose}") is to collect the following information through natural conversation — do not read it like a form, ask one thing at a time, and briefly acknowledge each answer before moving on:`,
    fieldLines,
    `Keep turns short — this is a phone call, not a chat. If the person seems confused, asks to be called back, or declines, politely wrap up and end the call rather than pushing for an answer.`,
    `If you reach voicemail or an answering machine, leave a brief callback message and end the call — don't try to collect information from a recording.`,
    `When you've collected everything (or the person has declined to continue), thank them and end the call.`,
  ]
    .filter((line): line is string => line != null)
    .join("\n\n");
}

// Any Vapi-supported model provider works here (anthropic, openai, xai,
// together-ai, …) — this just needs {provider, model} in the same shape.
// Defaults to Gemini per the project's current priority; override with
// CALLING_AGENT_MODEL_PROVIDER / CALLING_AGENT_MODEL without touching code.
// Valid model ids per provider: https://docs.vapi.ai/providers/model
function modelConfig(messages: Vapi.OpenAiMessage[]): Vapi.CreateAssistantDtoModel {
  const provider = process.env.CALLING_AGENT_MODEL_PROVIDER ?? "google";
  const model = process.env.CALLING_AGENT_MODEL ?? "gemini-2.5-flash";
  return { provider, model, messages, temperature: 0.3 } as Vapi.CreateAssistantDtoModel;
}

const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // "Rachel" — ElevenLabs' stock default voice.

function voiceConfig(): Vapi.CreateAssistantDtoVoice {
  return {
    provider: "11labs",
    voiceId: process.env.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID,
  };
}

// Vapi's own voicemail/IVR classifier — used as the interim human-detection
// signal (see lib/calling-agent/human-detection.ts) until the real model is
// wired in. Not a liveness/anti-spoofing check.
function voicemailDetectionConfig(): Vapi.CreateAssistantDtoVoicemailDetection {
  return { provider: "vapi" };
}

// Vapi has no inline `server.secret` anymore (see
// lib/calling-agent/webhook-auth.ts) — a plain header serves the same
// purpose and stays fully code-settable.
function serverConfig(): Vapi.Server | undefined {
  const url = process.env.CALLING_AGENT_WEBHOOK_URL;
  if (!url) return undefined;
  return {
    url,
    headers: { [WEBHOOK_SECRET_HEADER]: requiredEnv("CALLING_AGENT_WEBHOOK_SECRET") },
  };
}

function structuredDataPlan(fields: IntakeField[]): Vapi.StructuredDataPlan {
  return { enabled: true, schema: intakeSchema(fields) };
}

/**
 * The persistent assistant config — voice/model/transcriber/webhook, the
 * parts that don't change call-to-call. Used by
 * scripts/calling-agent/sync-assistant.ts to create/update the one saved
 * assistant. Per-call specifics (who we're calling, what to ask) are NOT
 * here — see callOverrides() below.
 */
export function baseAssistantConfig(): Vapi.CreateAssistantDto {
  return {
    name: ASSISTANT_NAME,
    model: modelConfig([{ role: "system", content: buildSystemPrompt(DEFAULT_PURPOSE, DEFAULT_INTAKE_FIELDS) }]),
    voice: voiceConfig(),
    firstMessage: buildFirstMessage(DEFAULT_PURPOSE),
    firstMessageMode: "assistant-speaks-first",
    voicemailDetection: voicemailDetectionConfig(),
    server: serverConfig(),
    analysisPlan: { structuredDataPlan: structuredDataPlan(DEFAULT_INTAKE_FIELDS) },
    maxDurationSeconds: 600,
  };
}

export interface CallOverridesOptions {
  purpose?: string;
  fields?: IntakeField[];
  customerName?: string | null;
  /**
   * Free-text detail specific to this one call — e.g. for
   * PURCHASE_VERIFICATION_PURPOSE, the actual transaction: "a $42.50 charge
   * at Acme Hardware on the card ending 1234, made 3 minutes ago." Without
   * this the agent knows the *shape* of what to ask (the fields) but not
   * the specifics of *this* call.
   */
  context?: string | null;
}

/**
 * Per-call overrides layered onto the saved assistant (via
 * CreateCallDto.assistantOverrides) — lets one assistant handle many kinds
 * of calls (different purpose, different fields to collect, personalized
 * greeting) without creating a new Vapi assistant per call.
 */
export function callOverrides({
  purpose = DEFAULT_PURPOSE,
  fields = DEFAULT_INTAKE_FIELDS,
  customerName,
  context,
}: CallOverridesOptions): Vapi.AssistantOverrides {
  return {
    model: modelConfig([{ role: "system", content: buildSystemPrompt(purpose, fields, customerName, context) }]),
    firstMessage: buildFirstMessage(purpose, customerName),
    firstMessageMode: "assistant-speaks-first",
    analysisPlan: { structuredDataPlan: structuredDataPlan(fields) },
  };
}
