// The shape of a Backboard memory as the dashboard displays it, plus the
// normalization that gets Backboard's raw search response into that shape.
//
// Deliberately NOT a summarizer: nothing here interprets, ranks, rewrites,
// or asks a model about a memory's content. `content` comes through byte
// for byte as Backboard stored it. The only transformation is making
// metadata values renderable as text (see normalizeMetadataValue), because
// JSX can't render an arbitrary object. Same principle as the rest of
// /dashboard — show what's actually in the data, don't generate a
// plausible-looking version of it.
//
// Pure on purpose: no `pg`, no `fetch`, no env vars. That's what makes the
// schema unit-testable without a DB or a live Backboard account
// (lib/__tests__/memory-schema.test.ts). The I/O lives in
// lib/backboard-memories.ts.

export interface RetrievedMemory {
  id: string;
  /** Backboard's stored memory text, verbatim. */
  content: string;
  /** Cosine similarity to the search query. null when Backboard omits it. */
  score: number | null;
  /** ISO-ish timestamp string as Backboard returned it, not re-parsed into a Date. */
  createdAt: string | null;
  /** Backboard's metadata, values flattened to display strings. Never null — an absent metadata object is {}. */
  metadata: Record<string, string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Backboard stores every non-integer float in metadata as a STRING, not a
 * number — gmail-connector's lib/backboard.ts sanitizeMetadata() does that
 * on write to dodge a Backboard 500 (see the comment there). So a
 * similarity of 0.528 comes back as "0.528". Passing those through
 * untouched is the correct behaviour, not a bug to normalize away: the
 * string IS the stored value.
 */
function normalizeMetadataValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    // Circular structures — nothing displayable to salvage.
    return null;
  }
}

function normalizeMetadata(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalized = normalizeMetadataValue(raw);
    // A key whose value is null/undefined carries no information worth a
    // blank row in the UI, so it's dropped rather than rendered empty.
    if (normalized !== null) out[key] = normalized;
  }
  return out;
}

function normalizeScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalizeTimestamp(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * One raw memory object -> RetrievedMemory, or null if it can't be one.
 *
 * id and content are the only required fields: a memory with no id can't be
 * keyed in a list and one with no content has nothing to show. Everything
 * else degrades to null/{} rather than rejecting the row, so a single
 * unexpected field from Backboard doesn't cost us a memory we could have
 * displayed.
 */
export function toRetrievedMemory(raw: unknown): RetrievedMemory | null {
  if (!isPlainObject(raw)) return null;

  const id = typeof raw.id === "string" && raw.id !== "" ? raw.id : null;
  const content = typeof raw.content === "string" && raw.content !== "" ? raw.content : null;
  if (id === null || content === null) return null;

  return {
    id,
    content,
    score: normalizeScore(raw.score),
    createdAt: normalizeTimestamp(raw.created_at),
    metadata: normalizeMetadata(raw.metadata),
  };
}

/**
 * Backboard's POST /assistants/{id}/memories/search response body ->
 * RetrievedMemory[], preserving Backboard's own relevance ordering.
 *
 * Never throws. A malformed response yields [] and a malformed row inside a
 * good response is skipped — this feeds a supplementary panel on the
 * dashboard, so degrading to "no memories shown" beats failing the whole
 * page load over a shape change in a third-party API.
 */
export function parseMemorySearchResponse(raw: unknown, limit?: number): RetrievedMemory[] {
  if (!isPlainObject(raw) || !Array.isArray(raw.memories)) return [];

  const parsed = raw.memories
    .map(toRetrievedMemory)
    .filter((memory): memory is RetrievedMemory => memory !== null);

  return limit !== undefined && limit >= 0 ? parsed.slice(0, limit) : parsed;
}

/**
 * Backboard's timestamp string -> something readable next to a memory.
 *
 * Formatted in UTC, not the viewer's zone, so server and client renders
 * agree (no hydration mismatch) and the displayed date always matches the
 * instant Backboard stored. An unparseable value falls through to the raw
 * string rather than being hidden or guessed at.
 */
export function formatMemoryTimestamp(value: string | null): string | null {
  if (value === null) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Runtime form of the RetrievedMemory contract. This is the schema the unit
 * tests assert against — a compile-time type alone can't catch a shape that
 * only goes wrong on data arriving at runtime, which is exactly the case
 * here since the input is an untyped third-party JSON body.
 */
export function isRetrievedMemory(value: unknown): value is RetrievedMemory {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string" || value.id === "") return false;
  if (typeof value.content !== "string" || value.content === "") return false;
  if (value.score !== null && (typeof value.score !== "number" || !Number.isFinite(value.score))) return false;
  if (value.createdAt !== null && typeof value.createdAt !== "string") return false;
  if (!isPlainObject(value.metadata)) return false;
  return Object.values(value.metadata).every((v) => typeof v === "string");
}
