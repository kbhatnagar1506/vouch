// Server-side Persona (withpersona.com) client + the DB reads/writes that
// go with it. Response shaping and signature verification live in
// lib/persona-schema.ts so they stay unit-testable; this file is the I/O.
import { pool } from "@/lib/db";
import { parseInquiry, type VerifiedIdentity } from "@/lib/persona-schema";

const BASE_URL = "https://api.withpersona.com/api/v1";

// Pinned rather than omitted. Persona's versioning docs say the header is
// optional and falls back to "your API key's settings" — which means the
// response shape this code parses could change under us when a dashboard
// setting is edited by someone who has never seen this file. Pinning makes
// upgrades a deliberate commit.
const PERSONA_VERSION = "2025-12-08";

export function isConfigured(): boolean {
  return Boolean(process.env.PERSONA_API_KEY && process.env.PERSONA_TEMPLATE_ID);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See docs/IDENTITY.md for setup.`);
  }
  return value;
}

async function personaFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requiredEnv("PERSONA_API_KEY")}`,
      "Content-Type": "application/json",
      "Persona-Version": PERSONA_VERSION,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Persona API ${path} failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

export interface CreatedInquiry {
  inquiryId: string;
  /** Required by the embedded SDK to open an inquiry that already exists. */
  sessionToken: string | null;
}

/**
 * Creates an inquiry server-side, then hands the id + session token to the
 * browser for the embedded widget to open.
 *
 * Deliberately NOT letting the client create it from a template id: the
 * template and the reference id (our user id) are then chosen by code the
 * user controls, so anyone could point the widget at a weaker template or
 * attach a verification to someone else's account. Creating it here means
 * the browser only ever gets a token for an inquiry we already bound to the
 * right user.
 */
export async function createInquiry(userId: string): Promise<CreatedInquiry> {
  const body = {
    data: {
      attributes: {
        "inquiry-template-id": requiredEnv("PERSONA_TEMPLATE_ID"),
      },
    },
    meta: {
      "auto-create-account": true,
      // Persona's Account is keyed by this, which is what lets a later
      // re-verification (or account recovery) find a person's earlier
      // inquiries and run selfie_account_comparison against them.
      "auto-create-account-reference-id": userId,
      "auto-create-inquiry-session": true,
    },
  };

  const created = await personaFetch<{
    data?: { id?: string };
    meta?: { "session-token"?: string };
  }>("/inquiries", { method: "POST", body: JSON.stringify(body) });

  const inquiryId = created.data?.id;
  if (!inquiryId) {
    throw new Error("Persona did not return an inquiry id");
  }
  return { inquiryId, sessionToken: created.meta?.["session-token"] ?? null };
}

/** Fetches an inquiry with its verifications hydrated into `included`. */
export async function fetchInquiry(inquiryId: string): Promise<VerifiedIdentity | null> {
  const raw = await personaFetch<unknown>(`/inquiries/${inquiryId}?include=verifications`);
  return parseInquiry(raw);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface IdentityRow {
  userId: string;
  inquiryId: string;
  status: string;
  nameFirst: string | null;
  nameLast: string | null;
  isOver18: boolean | null;
  phoneVerified: boolean;
  updatedAt: Date;
}

export async function getIdentity(userId: string): Promise<IdentityRow | null> {
  try {
    const { rows } = await pool.query<{
      user_id: string;
      inquiry_id: string;
      status: string;
      name_first: string | null;
      name_last: string | null;
      is_over_18: boolean | null;
      phone_verified: boolean;
      updated_at: Date;
    }>(
      `select user_id, inquiry_id, status, name_first, name_last, is_over_18, phone_verified, updated_at
       from identity_verifications where user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      inquiryId: row.inquiry_id,
      status: row.status,
      nameFirst: row.name_first,
      nameLast: row.name_last,
      isOver18: row.is_over_18,
      phoneVerified: row.phone_verified,
      updatedAt: row.updated_at,
    };
  } catch {
    // Table may not exist yet on a DB that hasn't had this branch's
    // migration applied — the dashboard must still render, at the
    // observe-only tier. Same defensive posture as dashboard-data.ts.
    return null;
  }
}

/** Upsert from a parsed inquiry. One row per user; re-verification replaces it. */
export async function saveIdentity(userId: string, identity: VerifiedIdentity): Promise<void> {
  await pool.query(
    `insert into identity_verifications (
       user_id, inquiry_id, account_id, status,
       name_first, name_last,
       address_street_1, address_street_2, address_city,
       address_subdivision, address_postal_code, address_country_code,
       is_over_18, phone_verified, selfie_liveness_passed, selfie_document_similarity,
       updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, now())
     on conflict (user_id) do update set
       inquiry_id = excluded.inquiry_id,
       account_id = excluded.account_id,
       status = excluded.status,
       name_first = coalesce(excluded.name_first, identity_verifications.name_first),
       name_last = coalesce(excluded.name_last, identity_verifications.name_last),
       address_street_1 = coalesce(excluded.address_street_1, identity_verifications.address_street_1),
       address_street_2 = coalesce(excluded.address_street_2, identity_verifications.address_street_2),
       address_city = coalesce(excluded.address_city, identity_verifications.address_city),
       address_subdivision = coalesce(excluded.address_subdivision, identity_verifications.address_subdivision),
       address_postal_code = coalesce(excluded.address_postal_code, identity_verifications.address_postal_code),
       address_country_code = coalesce(excluded.address_country_code, identity_verifications.address_country_code),
       is_over_18 = coalesce(excluded.is_over_18, identity_verifications.is_over_18),
       phone_verified = excluded.phone_verified or identity_verifications.phone_verified,
       selfie_liveness_passed = coalesce(excluded.selfie_liveness_passed, identity_verifications.selfie_liveness_passed),
       selfie_document_similarity = coalesce(excluded.selfie_document_similarity, identity_verifications.selfie_document_similarity),
       updated_at = now()`,
    [
      userId,
      identity.inquiryId,
      identity.accountId,
      identity.status,
      identity.nameFirst,
      identity.nameLast,
      identity.addressStreet1,
      identity.addressStreet2,
      identity.addressCity,
      identity.addressSubdivision,
      identity.addressPostalCode,
      identity.addressCountryCode,
      identity.isOver18,
      identity.phoneVerified,
      identity.selfieLivenessPassed,
      identity.selfieDocumentSimilarity,
    ],
  );
}

/** Which user an inquiry belongs to — webhooks arrive with no session. */
export async function userIdForInquiry(inquiryId: string): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string }>(
    "select user_id from identity_verifications where inquiry_id = $1",
    [inquiryId],
  );
  return rows[0]?.user_id ?? null;
}

export async function recordEvent(inquiryId: string | null, eventName: string, payload: unknown): Promise<void> {
  await pool.query(
    "insert into identity_verification_events (inquiry_id, event_name, payload) values ($1,$2,$3)",
    [inquiryId, eventName, JSON.stringify(payload)],
  );
}

/**
 * Binds the user's voice enrollment to the inquiry that proved who they are.
 *
 * This is the point of the whole integration: `voice_enrollments` on its own
 * proves only that the voice on a call matches the voice that enrolled. With
 * an inquiry attached, every later speaker-match inherits a government-ID
 * check — which is what lets the calling agent treat "the voice matched" as
 * authorization to spend.
 *
 * Best-effort: the enrollment row may not exist yet (a user can verify
 * before enrolling), and that must not fail the verification.
 */
export async function bindVoiceEnrollment(userId: string, inquiryId: string): Promise<void> {
  try {
    await pool.query("update voice_enrollments set persona_inquiry_id = $2 where user_id = $1", [userId, inquiryId]);
  } catch {
    // voice_enrollments is owned by the voice-verification branch and may
    // not exist on every DB.
  }
}
