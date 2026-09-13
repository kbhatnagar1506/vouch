// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/memory/__tests__/search.test.ts (commit 55eedf7) — mocks
// @/lib/memory/tenant, @/lib/embeddings and @/lib/memory/store directly,
// none of which changed shape in the port, so no adaptation needed.
import { describe, expect, it, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const mockClient = { query: queryMock };
const withUserScopeMock = vi.fn((userId: string, fn: (client: unknown) => unknown) =>
  fn(mockClient),
);
vi.mock("@/lib/memory/tenant", () => ({
  withUserScope: (...args: [string, (client: unknown) => unknown]) =>
    withUserScopeMock(...args),
}));

const embedTextsMock = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  embedTexts: (...args: unknown[]) => embedTextsMock(...args),
  toPgVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const getMemoriesByIdsMock = vi.fn();
vi.mock("@/lib/memory/store", () => ({
  getMemoriesByIds: (...args: unknown[]) => getMemoriesByIdsMock(...args),
}));

import { vectorSearch, lexicalSearch, searchMemories } from "@/lib/memory/search";

function memory(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    userId: "user-1",
    content: `content ${id}`,
    summary: "",
    metadata: {},
    tags: [],
    source: "",
    status: "active",
    occurredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    contentSha256: "hash",
    version: 1,
    ...overrides,
  };
}

describe("vectorSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("converts cosine distance to similarity (1 - dist)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ memory_id: "m1", dist: "0.2" }] });

    const result = await vectorSearch("user-1", [0.1, 0.2], 10);

    expect(result.ids).toEqual(["m1"]);
    expect(result.scores.get("m1")).toBeCloseTo(0.8);
  });

  it("adds a tag filter clause and parameter when tags are given", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await vectorSearch("user-1", [0.1], 10, { tags: ["rent"] });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/m\.tags @> \$4::text\[\]/);
    expect(params[3]).toEqual(["rent"]);
  });
});

describe("lexicalSearch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns ids ranked by ts_rank_cd", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { memory_id: "m1", rank: "0.5" },
        { memory_id: "m2", rank: "0.1" },
      ],
    });

    const result = await lexicalSearch("user-1", "rent payment", 10);

    expect(result.ids).toEqual(["m1", "m2"]);
    expect(result.scores.get("m1")).toBeCloseTo(0.5);
  });
});

describe("searchMemories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);
  });

  it("fuses vector and lexical hits and hydrates them to full memories", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ memory_id: "m1", dist: "0.1" }] }) // vector
      .mockResolvedValueOnce({ rows: [{ memory_id: "m2", rank: "0.4" }] }) // lexical
      .mockResolvedValueOnce({ rows: [] }); // supersession check
    getMemoriesByIdsMock.mockResolvedValue([memory("m1"), memory("m2")]);

    const hits = await searchMemories("user-1", "rent");

    expect(hits.map((h) => h.memory.id).sort()).toEqual(["m1", "m2"]);
  });

  it("drops a hit that a co-present hit transitively supersedes", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ memory_id: "m-old", dist: "0.1" }] })
      .mockResolvedValueOnce({ rows: [{ memory_id: "m-new", rank: "0.4" }] })
      .mockResolvedValueOnce({ rows: [{ source_id: "m-new", target_id: "m-old" }] });
    getMemoriesByIdsMock.mockResolvedValue([memory("m-old"), memory("m-new")]);

    const hits = await searchMemories("user-1", "rent");

    expect(hits.map((h) => h.memory.id)).toEqual(["m-new"]);
  });

  it("keeps a stale hit visible when its successor is not also in the result set", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ memory_id: "m-old", dist: "0.1" }] })
      .mockResolvedValueOnce({ rows: [] });
    // Only one candidate (m-old alone) -- suppressSuperseded short-circuits
    // for < 2 hits, so no relations query runs at all.
    getMemoriesByIdsMock.mockResolvedValue([memory("m-old")]);

    const hits = await searchMemories("user-1", "rent");

    expect(hits.map((h) => h.memory.id)).toEqual(["m-old"]);
    expect(queryMock).toHaveBeenCalledTimes(2); // vector + lexical only, no suppression query
  });

  it("respects the limit after fusion and suppression", async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          { memory_id: "m1", dist: "0.1" },
          { memory_id: "m2", dist: "0.2" },
          { memory_id: "m3", dist: "0.3" },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    getMemoriesByIdsMock.mockResolvedValue([memory("m1"), memory("m2"), memory("m3")]);

    const hits = await searchMemories("user-1", "rent", { limit: 2 });

    expect(hits).toHaveLength(2);
  });
});
