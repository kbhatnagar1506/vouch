// Ported verbatim from aaditisinghal/vouch-aaditi's src/lib/memory/fusion.ts
// (commit 55eedf7) — no DB or auth dependency, no adaptation needed.

export const DEFAULT_RRF_K = 60;

export interface RankedList {
  name: string;
  ids: string[];
  /** Raw per-id scores, retained only for explanation. */
  scores?: Map<string, number>;
  weight?: number;
}

export interface FusedItem {
  id: string;
  score: number;
  /** list name -> 1-based rank in that list */
  ranks: Map<string, number>;
  /** list name -> that list's raw score */
  raw: Map<string, number>;
}

export interface ReciprocalRankFusionOptions {
  k?: number;
  limit?: number;
}

/**
 * Fuses ranked lists by Reciprocal Rank Fusion: score(d) = sum over lists L of
 * weight_L / (k + rank_L(d)). Combines ranks rather than raw scores, since
 * cosine similarity and a lexical rank score are not on a comparable scale.
 * Deterministic: ties break on id, so paging stays stable.
 */
export function reciprocalRankFusion(
  lists: RankedList[],
  opts: ReciprocalRankFusionOptions = {},
): FusedItem[] {
  const k = opts.k ?? DEFAULT_RRF_K;
  if (k < 1) {
    throw new Error("rrf k must be >= 1");
  }

  const accumulated = new Map<string, FusedItem>();

  for (const ranked of lists) {
    const weight = ranked.weight ?? 1.0;
    if (weight === 0) continue;
    if (weight < 0) {
      throw new Error(`${ranked.name}: weight must be non-negative`);
    }
    if (new Set(ranked.ids).size !== ranked.ids.length) {
      throw new Error(`${ranked.name}: duplicate ids in a ranked list`);
    }

    ranked.ids.forEach((id, index) => {
      const position = index + 1;
      let item = accumulated.get(id);
      if (!item) {
        item = { id, score: 0, ranks: new Map(), raw: new Map() };
        accumulated.set(id, item);
      }
      item.score += weight / (k + position);
      item.ranks.set(ranked.name, position);
      const rawScore = ranked.scores?.get(id);
      if (rawScore !== undefined) {
        item.raw.set(ranked.name, rawScore);
      }
    });
  }

  const ordered = Array.from(accumulated.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return opts.limit !== undefined ? ordered.slice(0, opts.limit) : ordered;
}
