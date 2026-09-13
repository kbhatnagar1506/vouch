// Adapted from aaditisinghal/vouch-aaditi's src/lib/backboard.ts
// (commit 55eedf7) — only the db import changed (named `pool` export here,
// vs. a default export there). Logic, including both empirically-discovered
// Backboard API bugs and their workarounds, is otherwise identical.
import { pool } from "@/lib/db";

const BASE_URL = "https://app.backboard.io/api";

/**
 * Backboard's POST /assistants/{id}/memories endpoint throws an unhandled
 * 500 ("Something went wrong. Please try again later.") for any content
 * over 4096 UTF-8 BYTES -- confirmed empirically by bisection using
 * Buffer.byteLength (4096 bytes succeeds, 4097 fails, every time,
 * independent of character count). It is not documented, not validated
 * client-side by them, and easy to miss by capping on `.length` instead --
 * `.length` counts UTF-16 code units, so any smart quote, arrow, or other
 * multi-byte character in a Gmail body throws that off by exactly the
 * difference that trips this bug.
 */
const MAX_MEMORY_CONTENT_BYTES = 4096;
const ELLIPSIS = "…"; // U+2026, 3 bytes in UTF-8

function capContentLength(content: string): string {
  if (Buffer.byteLength(content, "utf8") <= MAX_MEMORY_CONTENT_BYTES) return content;

  const budget = MAX_MEMORY_CONTENT_BYTES - Buffer.byteLength(ELLIPSIS, "utf8");
  // Truncate on the byte boundary, then decode back to a string. A cut that
  // lands mid-character leaves a trailing U+FFFD replacement character,
  // which toString("utf8") inserts rather than throwing -- drop it before
  // appending the ellipsis so the result is valid UTF-8 the whole way through.
  const truncated = Buffer.from(content, "utf8")
    .subarray(0, budget)
    .toString("utf8")
    .replace(/�$/, "");
  return truncated + ELLIPSIS;
}

/**
 * Backboard's memory endpoint also throws an unhandled 500 for ANY
 * non-integer float value inside `metadata` (e.g. 0.528) -- confirmed
 * empirically: integers succeed, 1.0 succeeds (JSON serializes it as `1`),
 * 0.5 and 2500.5 both 500. Converting the offending values to strings
 * sidesteps their bug without losing precision or silently dropping data.
 */
function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return metadata;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] =
      typeof value === "number" && !Number.isInteger(value) ? String(value) : value;
  }
  return sanitized;
}

export interface BackboardMemory {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BackboardAssistant {
  assistantId: string;
  name: string;
  createdAt: string;
}

export interface SearchMemoriesResult {
  memories: BackboardMemory[];
  totalCount: number;
}

export interface ListMemoriesResult {
  memories: BackboardMemory[];
  totalCount: number;
  page: number | null;
  pageSize: number | null;
  totalPages: number | null;
}

function getApiKey(): string {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) {
    throw new Error("BACKBOARD_API_KEY environment variable must be set");
  }
  return key;
}

async function backboardFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "X-API-Key": getApiKey(),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backboard API request failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

function toBackboardMemory(raw: {
  id: string;
  content: string;
  metadata?: Record<string, unknown> | null;
  score?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}): BackboardMemory {
  return {
    id: raw.id,
    content: raw.content,
    metadata: raw.metadata ?? null,
    score: raw.score ?? null,
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}

export async function createAssistant(
  name: string,
  systemPrompt?: string,
): Promise<BackboardAssistant> {
  const data = await backboardFetch<{
    assistant_id: string;
    name: string;
    created_at: string;
  }>("/assistants", {
    method: "POST",
    body: JSON.stringify({ name, system_prompt: systemPrompt }),
  });
  return { assistantId: data.assistant_id, name: data.name, createdAt: data.created_at };
}

export async function addMemory(
  assistantId: string,
  content: string,
  metadata?: Record<string, unknown>,
): Promise<BackboardMemory> {
  // POST's response shape is undocumented (OpenAPI just says
  // `additionalProperties: true`) and, confirmed empirically, is NOT the same
  // MemoryResponse shape GET/list/search return: it comes back as
  // {success, message, memory_id, content} -- the id key is `memory_id`, not
  // `id`. Mapping this through toBackboardMemory's `id` field silently
  // produced `undefined` here even though the request itself succeeded.
  const data = await backboardFetch<{
    memory_id: string;
    content: string;
    metadata?: Record<string, unknown> | null;
  }>(`/assistants/${assistantId}/memories`, {
    method: "POST",
    body: JSON.stringify({ content: capContentLength(content), metadata: sanitizeMetadata(metadata) }),
  });
  return toBackboardMemory({ ...data, id: data.memory_id });
}

export async function listMemories(
  assistantId: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<ListMemoriesResult> {
  const params = new URLSearchParams();
  if (opts.page !== undefined) params.set("page", String(opts.page));
  if (opts.pageSize !== undefined) params.set("page_size", String(opts.pageSize));
  const query = params.toString() ? `?${params.toString()}` : "";

  const data = await backboardFetch<{
    memories: Parameters<typeof toBackboardMemory>[0][];
    total_count: number;
    page: number | null;
    page_size: number | null;
    total_pages: number | null;
  }>(`/assistants/${assistantId}/memories${query}`);

  return {
    memories: data.memories.map(toBackboardMemory),
    totalCount: data.total_count,
    page: data.page,
    pageSize: data.page_size,
    totalPages: data.total_pages,
  };
}

export async function searchMemories(
  assistantId: string,
  query: string,
  limit = 5,
): Promise<SearchMemoriesResult> {
  const data = await backboardFetch<{
    memories: Parameters<typeof toBackboardMemory>[0][];
    total_count: number;
  }>(`/assistants/${assistantId}/memories/search`, {
    method: "POST",
    body: JSON.stringify({ query, limit }),
  });
  return { memories: data.memories.map(toBackboardMemory), totalCount: data.total_count };
}

export async function getMemory(assistantId: string, memoryId: string): Promise<BackboardMemory> {
  const data = await backboardFetch<Parameters<typeof toBackboardMemory>[0]>(
    `/assistants/${assistantId}/memories/${memoryId}`,
  );
  return toBackboardMemory(data);
}

export async function deleteMemory(assistantId: string, memoryId: string): Promise<void> {
  await backboardFetch(`/assistants/${assistantId}/memories/${memoryId}`, { method: "DELETE" });
}

/**
 * Backboard scopes memory per-assistant, so each Vouch user gets exactly one
 * assistant, created lazily on first use and cached in backboard_assistants.
 */
export async function ensureBackboardAssistant(userId: string): Promise<string> {
  const existing = await pool.query<{ assistant_id: string }>(
    "SELECT assistant_id FROM backboard_assistants WHERE user_id = $1",
    [userId],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].assistant_id;
  }

  const assistant = await createAssistant(
    `vouch-${userId}`,
    "Persistent financial memory for a single Vouch user: receipts, subscriptions, and spending history.",
  );

  const inserted = await pool.query<{ assistant_id: string }>(
    `INSERT INTO backboard_assistants (user_id, assistant_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET assistant_id = backboard_assistants.assistant_id
     RETURNING assistant_id`,
    [userId, assistant.assistantId],
  );
  return inserted.rows[0].assistant_id;
}
