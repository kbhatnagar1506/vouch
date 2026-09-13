// Trimmed port of gmail-connector's lib/backboard.ts -- only the read path
// (search an existing assistant's memories) is needed here; this branch
// never creates a Backboard assistant or writes memories, only reads
// whatever gmail-connector's sync already wrote there. Per this repo's
// no-shared-code-across-branches convention.
const BASE_URL = "https://app.backboard.io/api";

function getApiKey(): string {
  const key = process.env.BACKBOARD_API_KEY;
  if (!key) {
    throw new Error("BACKBOARD_API_KEY is not set. See gmail-connector's lib/backboard.ts for where this comes from.");
  }
  return key;
}

async function backboardFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "X-API-Key": getApiKey(), "Content-Type": "application/json", ...init.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Backboard API request failed (${response.status}): ${body}`);
  }
  return response.json() as Promise<T>;
}

export interface BackboardMemory {
  id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  score: number | null;
}

/**
 * Top-k relevant memories for a user's Backboard assistant, or `[]` if they
 * don't have one yet (e.g. Gmail was never connected -- gmail-sync creates
 * the assistant lazily on first sync, see that branch's
 * ensureBackboardAssistant()). Never throws for "no assistant" -- a call
 * should still go through with whatever context it already has, just
 * without this enrichment.
 */
export async function topKPaymentContext(userId: string, query: string, k = 5): Promise<BackboardMemory[]> {
  const { pool } = await import("@/lib/db");
  const { rows } = await pool.query<{ assistant_id: string }>(
    "select assistant_id from backboard_assistants where user_id = $1",
    [userId],
  );
  const assistantId = rows[0]?.assistant_id;
  if (!assistantId) return [];

  try {
    const data = await backboardFetch<{
      memories: Array<{ id: string; content: string; metadata?: Record<string, unknown> | null; score?: number | null }>;
    }>(`/assistants/${assistantId}/memories/search`, {
      method: "POST",
      body: JSON.stringify({ query, limit: k }),
    });
    return data.memories.map((m) => ({ id: m.id, content: m.content, metadata: m.metadata ?? null, score: m.score ?? null }));
  } catch (error) {
    // Backboard being unreachable/erroring shouldn't block placing the
    // call -- same "non-fatal, log and move on" treatment gmail-sync
    // gives it (see gmail-connector's lib/gmail-sync.ts writeToBackboard).
    console.error("topKPaymentContext failed:", error);
    return [];
  }
}

/** Renders memories as a short numbered list for inclusion in a prompt -- "" if there's nothing to add. */
export function formatMemoriesForPrompt(memories: BackboardMemory[]): string {
  if (memories.length === 0) return "";
  return memories.map((m, i) => `${i + 1}. ${m.content}`).join("\n");
}
