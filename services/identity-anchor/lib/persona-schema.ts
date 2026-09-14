// Shaping and verification logic for Persona's API responses and webhooks.
//
// Pure on purpose — no `pg`, no `fetch`, no env vars — so every rule below
// is unit-testable without a Persona account or a DB
// (lib/__tests__/persona-schema.test.ts). The I/O lives in lib/persona.ts.
//
// Persona speaks JSON:API with kebab-case keys by default (`name-first`,
// not `nameFirst`). We keep that default rather than setting
// `Key-Inflection: camel`, because the inflection header also rewrites the
// *field names* inside `fields`, which are part of the template's
// configuration rather than the transport — quietly coupling our parsing to
// a header. Explicit kebab accessors below instead.
import { createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The ONLY status that means "this person is verified".
 *
 * Persona's docs are explicit that `completed` must not be used for this:
 * it's set when the user reaches the final screen, which says nothing about
 * whether the checks passed. `approved` is set by a Workflow (or manual
 * review) after the results are actually evaluated. Gating on `completed`
 * is the single most common way these integrations ship broken — anyone who
 * walks to the end of the flow with a bad document would be let through.
 */
export const VERIFIED_STATUS = "approved";

export type InquiryStatus =
  | "created"
  | "pending"
  | "completed"
  | "failed"
  | "expired"
  | "approved"
  | "declined"
  | "needs_review";

/** Nothing further will happen without a new inquiry. */
const TERMINAL_STATUSES = new Set<string>(["approved", "declined", "failed", "expired"]);

export function isVerified(status: string | null | undefined): boolean {
  return status === VERIFIED_STATUS;
}

export function isTerminal(status: string | null | undefined): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

/**
 * What the agent is allowed to do, derived from verification state.
 *
 * The product rule: nobody is asked for an ID to look around. Verification
 * is what unlocks the agent's authority to *spend*, at the moment it first
 * needs it. See docs/IDENTITY.md.
 */
export type AgentTier = "observe" | "act";

export function agentTier(status: string | null | undefined): AgentTier {
  return isVerified(status) ? "act" : "observe";
}

// ---------------------------------------------------------------------------
// Inquiry parsing
// ---------------------------------------------------------------------------

export interface VerifiedIdentity {
  inquiryId: string;
  accountId: string | null;
  status: string;
  nameFirst: string | null;
  nameLast: string | null;
  addressStreet1: string | null;
  addressStreet2: string | null;
  addressCity: string | null;
  addressSubdivision: string | null;
  addressPostalCode: string | null;
  addressCountryCode: string | null;
  /** Derived from the government ID's birthdate, which is then discarded. */
  isOver18: boolean | null;
  phoneVerified: boolean;
  selfieLivenessPassed: boolean | null;
  selfieDocumentSimilarity: number | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Inquiry `fields` are wrapped: `{"name-first": {"type":"string","value":"Jane"}}`.
 * Government-ID verification attributes are flat: `{"name-first":"Jane"}`.
 * This reads either shape so one accessor covers both sources.
 */
function fieldValue(container: unknown, key: string): string | null {
  if (!isPlainObject(container)) return null;
  const raw = container[key];
  if (isPlainObject(raw)) return str(raw.value);
  return str(raw);
}

/**
 * Age from a birthdate, computed once so the birthdate itself never reaches
 * our database. Returns null for a missing or unparseable date rather than
 * defaulting either way — "we don't know" must not read as "under 18"
 * (locks out a legitimate user) or "over 18" (defeats the check).
 */
export function computeIsOver18(birthdate: string | null, now: Date = new Date()): boolean | null {
  if (!birthdate) return null;
  const born = new Date(birthdate);
  if (Number.isNaN(born.getTime())) return null;

  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - born.getUTCMonth();
  // Birthday hasn't landed yet this year — month earlier, or same month and
  // the day hasn't come round.
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < born.getUTCDate())) {
    age -= 1;
  }
  return age >= 18;
}

function findIncluded(included: unknown, type: string): Record<string, unknown> | null {
  if (!Array.isArray(included)) return null;
  for (const entry of included) {
    if (isPlainObject(entry) && entry.type === type) return entry;
  }
  return null;
}

function attributesOf(resource: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!resource) return null;
  return isPlainObject(resource.attributes) ? resource.attributes : null;
}

/** Did a named check inside a verification's `checks[]` pass? */
function checkPassed(attributes: Record<string, unknown> | null, checkName: string): boolean | null {
  if (!attributes || !Array.isArray(attributes.checks)) return null;
  for (const check of attributes.checks) {
    if (isPlainObject(check) && check.name === checkName) {
      if (check.status === "passed") return true;
      if (check.status === "failed") return false;
      // "not_applicable" — the check didn't run, which isn't a failure.
      return null;
    }
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A `GET /inquiries/{id}?include=verifications` response (or a webhook's
 * `payload`) -> the narrow set of fields we actually persist.
 *
 * Returns null only when there's no usable inquiry id — anything else
 * degrades to nulls, so a Persona response shape change costs us individual
 * fields rather than the whole verification.
 */
export function parseInquiry(raw: unknown, now: Date = new Date()): VerifiedIdentity | null {
  if (!isPlainObject(raw)) return null;
  const data = isPlainObject(raw.data) ? raw.data : null;
  if (!data) return null;

  const inquiryId = str(data.id);
  if (!inquiryId) return null;

  const attributes = attributesOf(data);
  const relationships = isPlainObject(data.relationships) ? data.relationships : null;

  let accountId: string | null = null;
  if (relationships && isPlainObject(relationships.account)) {
    const accountData = relationships.account.data;
    if (isPlainObject(accountData)) accountId = str(accountData.id);
  }

  const govId = attributesOf(findIncluded(raw.included, "verification/government-id"));
  const selfie = attributesOf(findIncluded(raw.included, "verification/selfie"));
  const phone = attributesOf(findIncluded(raw.included, "verification/phone-number"));

  // Prefer the government ID's extracted values over the inquiry's `fields`:
  // `fields` can be prefilled by us at creation time and edited by the user,
  // whereas the government-id verification is what was actually read off the
  // document. Only fall back to `fields` when the ID didn't supply one.
  const pick = (key: string): string | null => fieldValue(govId, key) ?? fieldValue(attributes?.fields, key);

  const birthdate = pick("birthdate");

  return {
    inquiryId,
    accountId,
    status: str(attributes?.status) ?? "created",
    nameFirst: pick("name-first"),
    nameLast: pick("name-last"),
    addressStreet1: pick("address-street-1"),
    addressStreet2: pick("address-street-2"),
    addressCity: pick("address-city"),
    addressSubdivision: pick("address-subdivision"),
    addressPostalCode: pick("address-postal-code"),
    addressCountryCode: pick("address-country-code"),
    isOver18: computeIsOver18(birthdate, now),
    phoneVerified: phone?.status === "passed",
    selfieLivenessPassed: checkPassed(selfie, "selfie_liveness_detection"),
    selfieDocumentSimilarity: num(selfie?.["document-similarity-score"]),
  };
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

/**
 * Verifies Persona's `Persona-Signature` header.
 *
 * Format is `t=<unix_ts>,v1=<hex_hmac>`, and during a secret rotation the
 * header carries TWO space-separated pairs — both must be accepted, or
 * rotating the secret silently drops webhooks. The signed string is
 * `"{t}.{rawBody}"`, HMAC-SHA256, hex.
 *
 * `rawBody` must be the exact bytes received (`await request.text()`), never
 * a re-serialized parse: JSON.stringify(JSON.parse(body)) reorders and
 * reformats, and the HMAC won't match.
 */
export function verifyPersonaSignature(
  header: string | null | undefined,
  rawBody: string,
  secret: string,
): boolean {
  if (!header || !secret) return false;

  // Each space-separated chunk is one `t=...,v1=...` pair.
  for (const chunk of header.trim().split(/\s+/)) {
    const timestamp = /(?:^|,)t=([^,]+)/.exec(chunk)?.[1];
    const signature = /(?:^|,)v1=([^,]+)/.exec(chunk)?.[1];
    if (!timestamp || !signature) continue;

    const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    // timingSafeEqual throws on a length mismatch, so check that first —
    // and a wrong-length signature is wrong regardless.
    if (expected.length !== signature.length) continue;
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return true;
  }
  return false;
}

/** Event name off a Persona webhook body, e.g. "inquiry.approved". */
export function webhookEventName(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null;
  const data = isPlainObject(raw.data) ? raw.data : null;
  const attributes = attributesOf(data);
  return str(attributes?.name);
}

/** The resource a webhook is about — same shape parseInquiry expects. */
export function webhookPayload(raw: unknown): unknown {
  if (!isPlainObject(raw)) return null;
  const data = isPlainObject(raw.data) ? raw.data : null;
  const attributes = attributesOf(data);
  return attributes?.payload ?? null;
}
