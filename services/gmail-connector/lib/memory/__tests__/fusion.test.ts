// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/memory/__tests__/fusion.test.ts (commit 55eedf7).
import { describe, expect, it } from "vitest";
import { reciprocalRankFusion, DEFAULT_RRF_K } from "@/lib/memory/fusion";

describe("reciprocalRankFusion", () => {
  it("returns [] for empty lists", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("scores a single list by 1/(k+rank)", () => {
    const result = reciprocalRankFusion([{ name: "vector", ids: ["a", "b"] }]);
    expect(result[0].id).toBe("a");
    expect(result[0].score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1));
    expect(result[1].id).toBe("b");
    expect(result[1].score).toBeCloseTo(1 / (DEFAULT_RRF_K + 2));
  });

  it("sums contributions across lists for a doc appearing in both", () => {
    const result = reciprocalRankFusion([
      { name: "vector", ids: ["a", "b"] },
      { name: "lexical", ids: ["b", "a"] },
    ]);
    // "a" is rank 1 in vector, rank 2 in lexical; "b" is rank 2 then rank 1 --
    // symmetric, so they tie and the id-based tiebreak decides order.
    const a = result.find((r) => r.id === "a")!;
    const b = result.find((r) => r.id === "b")!;
    expect(a.score).toBeCloseTo(b.score);
    expect(result[0].id).toBe("a"); // tie broken by id
  });

  it("boosts a doc found by both strategies over one found by only one", () => {
    const result = reciprocalRankFusion([
      { name: "vector", ids: ["a", "c"] },
      { name: "lexical", ids: ["b", "a"] },
    ]);
    const a = result.find((r) => r.id === "a")!;
    const b = result.find((r) => r.id === "b")!;
    expect(a.score).toBeGreaterThan(b.score);
  });

  it("ties break on id for stable ordering", () => {
    const result = reciprocalRankFusion([{ name: "v", ids: ["z", "a"] }, { name: "l", ids: ["a", "z"] }]);
    expect(result.map((r) => r.id)).toEqual(["a", "z"]);
  });

  it("excludes a list with weight 0 entirely", () => {
    const result = reciprocalRankFusion([
      { name: "vector", ids: ["a"], weight: 0 },
      { name: "lexical", ids: ["b"] },
    ]);
    expect(result.map((r) => r.id)).toEqual(["b"]);
  });

  it("applies a list's weight as a multiplier", () => {
    const result = reciprocalRankFusion([{ name: "vector", ids: ["a"], weight: 2 }]);
    expect(result[0].score).toBeCloseTo((2 * 1) / (DEFAULT_RRF_K + 1));
  });

  it("respects a limit", () => {
    const result = reciprocalRankFusion([{ name: "v", ids: ["a", "b", "c"] }], { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("retains raw scores per list for explanation", () => {
    const scores = new Map([["a", 0.9]]);
    const result = reciprocalRankFusion([{ name: "vector", ids: ["a"], scores }]);
    expect(result[0].raw.get("vector")).toBe(0.9);
  });

  it("records each list's 1-based rank", () => {
    const result = reciprocalRankFusion([{ name: "vector", ids: ["a", "b"] }]);
    expect(result[0].ranks.get("vector")).toBe(1);
    expect(result[1].ranks.get("vector")).toBe(2);
  });

  it("throws on a negative weight", () => {
    expect(() => reciprocalRankFusion([{ name: "v", ids: ["a"], weight: -1 }])).toThrow(
      /non-negative/,
    );
  });

  it("throws on duplicate ids within one list", () => {
    expect(() => reciprocalRankFusion([{ name: "v", ids: ["a", "a"] }])).toThrow(/duplicate/);
  });

  it("throws when k < 1", () => {
    expect(() => reciprocalRankFusion([{ name: "v", ids: ["a"] }], { k: 0 })).toThrow(/k must be/);
  });
});
