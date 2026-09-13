import { pool } from "@/lib/db";
import type { IntakeField } from "@/lib/calling-agent/assistant";

export interface CallRecord {
  id: string;
  userId: string;
  vapiCallId: string | null;
  vapiAssistantId: string | null;
  toNumber: string;
  purpose: string;
  context: string | null;
  intakeSchema: IntakeField[];
  status: string;
  endedReason: string | null;
  humanDetection: unknown;
  transcript: string | null;
  recordingUrl: string | null;
  structuredData: unknown;
  raw: unknown;
  createdAt: string;
  updatedAt: string;
}

interface CallRow {
  id: string;
  user_id: string;
  vapi_call_id: string | null;
  vapi_assistant_id: string | null;
  to_number: string;
  purpose: string;
  context: string | null;
  intake_schema: IntakeField[];
  status: string;
  ended_reason: string | null;
  human_detection: unknown;
  transcript: string | null;
  recording_url: string | null;
  structured_data: unknown;
  raw: unknown;
  created_at: string;
  updated_at: string;
}

function fromRow(row: CallRow): CallRecord {
  return {
    id: row.id,
    userId: row.user_id,
    vapiCallId: row.vapi_call_id,
    vapiAssistantId: row.vapi_assistant_id,
    toNumber: row.to_number,
    purpose: row.purpose,
    context: row.context,
    intakeSchema: row.intake_schema,
    status: row.status,
    endedReason: row.ended_reason,
    humanDetection: row.human_detection,
    transcript: row.transcript,
    recordingUrl: row.recording_url,
    structuredData: row.structured_data,
    raw: row.raw,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function insertCall(params: {
  userId: string;
  toNumber: string;
  purpose: string;
  fields: IntakeField[];
  context?: string | null;
}): Promise<CallRecord> {
  const { rows } = await pool.query<CallRow>(
    `insert into calling_agent_calls (user_id, to_number, purpose, intake_schema, context)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [params.userId, params.toNumber, params.purpose, JSON.stringify(params.fields), params.context ?? null],
  );
  return fromRow(rows[0]);
}

/** Called right after Vapi accepts the call-create request. */
export async function attachVapiCall(
  id: string,
  vapiCallId: string,
  vapiAssistantId: string | null,
  status: string,
  raw: unknown,
): Promise<void> {
  await pool.query(
    `update calling_agent_calls
     set vapi_call_id = $2, vapi_assistant_id = $3, status = $4, raw = $5, updated_at = now()
     where id = $1`,
    [id, vapiCallId, vapiAssistantId, status, JSON.stringify(raw ?? {})],
  );
}

/** Called if the Vapi API call itself fails (never got a vapi_call_id). */
export async function markCallFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `update calling_agent_calls set status = 'failed', ended_reason = $2, updated_at = now() where id = $1`,
    [id, error],
  );
}

export async function listCallsForUser(userId: string, limit = 50): Promise<CallRecord[]> {
  const { rows } = await pool.query<CallRow>(
    `select * from calling_agent_calls where user_id = $1 order by created_at desc limit $2`,
    [userId, limit],
  );
  return rows.map(fromRow);
}

export async function getCallForUser(id: string, userId: string): Promise<CallRecord | null> {
  const { rows } = await pool.query<CallRow>(`select * from calling_agent_calls where id = $1 and user_id = $2`, [id, userId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getCallByVapiId(vapiCallId: string): Promise<CallRecord | null> {
  const { rows } = await pool.query<CallRow>(`select * from calling_agent_calls where vapi_call_id = $1`, [vapiCallId]);
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function recordEvent(params: {
  callId: string | null;
  vapiCallId: string | null;
  eventType: string;
  payload: unknown;
}): Promise<void> {
  await pool.query(
    `insert into calling_agent_events (call_id, vapi_call_id, event_type, payload) values ($1, $2, $3, $4)`,
    [params.callId, params.vapiCallId, params.eventType, JSON.stringify(params.payload ?? {})],
  );
}

export interface CallUpdateFromWebhook {
  status?: string;
  endedReason?: string | null;
  transcript?: string | null;
  recordingUrl?: string | null;
  structuredData?: unknown;
  humanDetection?: unknown;
  raw?: unknown;
}

/** Partial update — fields left undefined keep their current DB value. */
export async function updateCallFromWebhook(vapiCallId: string, update: CallUpdateFromWebhook): Promise<CallRecord | null> {
  const { rows } = await pool.query<CallRow>(
    `update calling_agent_calls set
       status = coalesce($2, status),
       ended_reason = coalesce($3, ended_reason),
       transcript = coalesce($4, transcript),
       recording_url = coalesce($5, recording_url),
       structured_data = coalesce($6, structured_data),
       human_detection = coalesce($7, human_detection),
       raw = coalesce($8, raw),
       updated_at = now()
     where vapi_call_id = $1
     returning *`,
    [
      vapiCallId,
      update.status ?? null,
      update.endedReason ?? null,
      update.transcript ?? null,
      update.recordingUrl ?? null,
      update.structuredData !== undefined ? JSON.stringify(update.structuredData) : null,
      update.humanDetection !== undefined ? JSON.stringify(update.humanDetection) : null,
      update.raw !== undefined ? JSON.stringify(update.raw) : null,
    ],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}
