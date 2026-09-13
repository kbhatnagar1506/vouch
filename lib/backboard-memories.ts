// Reads the top-k most relevant Backboard memories for each subscription on
// the real dashboard.
//
// Write side lives on the gmail-connector branch (lib/gmail-sync.ts pushes
// every classified receipt/renewal email into the user's Backboard
// assistant). This branch only ever reads — it never creates an assistant,
// never adds a memory, and never deletes one. A user who hasn't connected
// Gmail yet simply has no assistant row, which is a no-op here, not an error.
//
// Only the search endpoint is ported rather than the whole client (per the
// root CLAUDE.md "no shared code across branches" convention) — that's the
// one call this branch needs. Response shaping is in lib/memory-schema.ts so
// it stays unit-testable without a DB or a live Backboard account.
import { pool } from "@/lib/db";
import { parseMemorySearchResponse, type RetrievedMemory } from "@/lib/memory-schema";

const BASE_URL = "https://app.backboard.io/api";

/** Top-k. Five is enough to show a real history in a popup without turning it into a wall of text. */
export const DEFAULT_MEMORY_LIMIT = 5;

async function getAssistantId(userId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ assistant_id: string }>(
      "select assistant_id from backboard_assistants where user_id = $1",
      [userId],
    );
    return rows[0]?.assistant_id ?? null;
  } catch {
    // backboard_assistants is owned by the gmail-connector branch and may
    // not exist on every DB yet — same defensive read as dashboard-data.ts's
    // user_profiles lookup.
    return null;
  }
}

async function searchMemories(
  assistantId: string,
  query: string,
  limit: number,
): Promise<RetrievedMemory[]> {
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) return [];

  const response = await fetch(`${BASE_URL}/assistants/${assistantId}/memories/search`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!response.ok) return [];

  return parseMemorySearchResponse(await response.json(), limit);
}

/**
 * Top-k memories for each subscription, keyed by subscription id.
 *
 * The merchant name is the semantic search query — Backboard decides what's
 * relevant to it and in what order, and we show that verbatim. Nothing here
 * re-ranks, filters by score, or summarizes the results.
 *
 * Every failure mode (no assistant, no API key, a Backboard outage, one bad
 * query) degrades to "no memories for that subscription". This is
 * supplementary evidence in a popup, so it must never be able to fail the
 * dashboard's page load.
 */
export async function memoriesForSubscriptions(
  userId: string,
  subscriptions: { id: string; name: string }[],
  limit: number = DEFAULT_MEMORY_LIMIT,
): Promise<Record<string, RetrievedMemory[]>> {
  if (subscriptions.length === 0) return {};

  const assistantId = await getAssistantId(userId);
  if (!assistantId) return {};

  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        return [sub.id, await searchMemories(assistantId, sub.name, limit)] as const;
      } catch {
        return [sub.id, [] as RetrievedMemory[]] as const;
      }
    }),
  );

  return Object.fromEntries(results.filter(([, memories]) => memories.length > 0));
}
