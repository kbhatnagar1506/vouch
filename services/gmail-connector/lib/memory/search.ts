// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/memory/search.ts
// (commit 55eedf7). Nothing here imports @/lib/db or casts user_id to
// ::uuid, so no changes were needed for the TEXT user_id in this repo.
import { withUserScope } from "@/lib/memory/tenant";
import { embedTexts, toPgVectorLiteral } from "@/lib/embeddings";
import { reciprocalRankFusion } from "@/lib/memory/fusion";
import { getMemoriesByIds, type Memory } from "@/lib/memory/store";

export interface SearchFilters {
  tags?: string[];
  occurredAfter?: Date;
  occurredBefore?: Date;
}

export interface SearchOptions extends SearchFilters {
  limit?: number;
}

export interface SearchHit {
  memory: Memory;
  score: number;
  vectorScore: number | null;
  lexicalScore: number | null;
}

interface CandidateSet {
  ids: string[];
  scores: Map<string, number>;
}

const DEFAULT_LIMIT = 10;
/** How many chunk-level candidates to overfetch relative to the final limit, giving supersession suppression room to drop a hit without leaving a gap. */
const CANDIDATE_MULTIPLIER = 3;

function buildFilterClause(
  filters: SearchFilters,
  startParamIndex: number,
): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let i = startParamIndex;

  if (filters.tags && filters.tags.length > 0) {
    clauses.push(`m.tags @> $${i}::text[]`);
    params.push(filters.tags);
    i++;
  }
  if (filters.occurredAfter) {
    clauses.push(`m.occurred_at >= $${i}`);
    params.push(filters.occurredAfter);
    i++;
  }
  if (filters.occurredBefore) {
    clauses.push(`m.occurred_at <= $${i}`);
    params.push(filters.occurredBefore);
    i++;
  }

  return { clause: clauses.map((c) => ` AND ${c}`).join(""), params };
}

export async function vectorSearch(
  userId: string,
  queryEmbedding: number[],
  limit: number,
  filters: SearchFilters = {},
): Promise<CandidateSet> {
  return withUserScope(userId, async (client) => {
    const { clause, params } = buildFilterClause(filters, 4);
    const result = await client.query(
      `SELECT mc.memory_id, MIN(mc.embedding <=> $2::vector) AS dist
       FROM memory_chunks mc
       JOIN memories m ON m.id = mc.memory_id
       WHERE mc.user_id = $1 AND mc.embedding IS NOT NULL AND m.status = 'active'${clause}
       GROUP BY mc.memory_id
       ORDER BY dist ASC
       LIMIT $3`,
      [userId, toPgVectorLiteral(queryEmbedding), limit, ...params],
    );
    const ids: string[] = [];
    const scores = new Map<string, number>();
    for (const row of result.rows) {
      ids.push(row.memory_id);
      scores.set(row.memory_id, 1 - Number(row.dist));
    }
    return { ids, scores };
  });
}

export async function lexicalSearch(
  userId: string,
  query: string,
  limit: number,
  filters: SearchFilters = {},
): Promise<CandidateSet> {
  return withUserScope(userId, async (client) => {
    const { clause, params } = buildFilterClause(filters, 4);
    const result = await client.query(
      `SELECT mc.memory_id, MAX(ts_rank_cd(mc.search_vector, websearch_to_tsquery('english', $2))) AS rank
       FROM memory_chunks mc
       JOIN memories m ON m.id = mc.memory_id
       WHERE mc.user_id = $1
         AND mc.search_vector @@ websearch_to_tsquery('english', $2)
         AND m.status = 'active'${clause}
       GROUP BY mc.memory_id
       ORDER BY rank DESC
       LIMIT $3`,
      [userId, query, limit, ...params],
    );
    const ids: string[] = [];
    const scores = new Map<string, number>();
    for (const row of result.rows) {
      ids.push(row.memory_id);
      scores.set(row.memory_id, Number(row.rank));
    }
    return { ids, scores };
  });
}

/**
 * Drops a hit when a DIFFERENT hit in the same result set transitively
 * supersedes it. Never suppresses into silence: if the successor did not
 * also match the query, the (now stale) fact stays visible rather than
 * disappearing with nothing to replace it.
 */
async function suppressSuperseded(userId: string, hits: SearchHit[]): Promise<SearchHit[]> {
  if (hits.length < 2) return hits;

  return withUserScope(userId, async (client) => {
    const ids = hits.map((h) => h.memory.id);
    const result = await client.query(
      `SELECT source_id, target_id FROM memory_relations
       WHERE user_id = $1 AND type = 'supersedes'
         AND source_id = ANY($2::uuid[]) AND target_id = ANY($2::uuid[])`,
      [userId, ids],
    );

    // target_id -> set of ids (within this result set) that supersede it
    const supersededBy = new Map<string, Set<string>>();
    for (const row of result.rows) {
      const set = supersededBy.get(row.target_id) ?? new Set<string>();
      set.add(row.source_id);
      supersededBy.set(row.target_id, set);
    }

    return hits.filter((hit) => !supersededBy.has(hit.memory.id));
  });
}

export async function searchMemories(userId: string, query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const candidateLimit = limit * CANDIDATE_MULTIPLIER;
  const filters: SearchFilters = {
    tags: options.tags,
    occurredAfter: options.occurredAfter,
    occurredBefore: options.occurredBefore,
  };

  const [queryEmbedding] = await embedTexts([query]);

  const [vector, lexical] = await Promise.all([
    vectorSearch(userId, queryEmbedding, candidateLimit, filters),
    lexicalSearch(userId, query, candidateLimit, filters),
  ]);

  const fused = reciprocalRankFusion(
    [
      { name: "vector", ids: vector.ids, scores: vector.scores },
      { name: "lexical", ids: lexical.ids, scores: lexical.scores },
    ],
    { limit: candidateLimit },
  );

  const memories = await getMemoriesByIds(userId, fused.map((f) => f.id));
  const memoryById = new Map(memories.map((m) => [m.id, m]));

  const hits: SearchHit[] = fused
    .map((f) => {
      const memory = memoryById.get(f.id);
      if (!memory) return null;
      return {
        memory,
        score: f.score,
        vectorScore: f.raw.get("vector") ?? null,
        lexicalScore: f.raw.get("lexical") ?? null,
      };
    })
    .filter((hit): hit is SearchHit => hit !== null);

  const suppressed = await suppressSuperseded(userId, hits);
  return suppressed.slice(0, limit);
}
