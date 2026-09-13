// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/memory/__tests__/store.test.ts (commit 55eedf7) — mocks
// @/lib/memory/tenant, @/lib/chunking and @/lib/embeddings directly, none of
// which changed shape in the port, so no adaptation needed.
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

const chunkTextMock = vi.fn();
vi.mock("@/lib/chunking", () => ({
  chunkText: (...args: unknown[]) => chunkTextMock(...args),
}));

const embedTextsMock = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  embedTexts: (...args: unknown[]) => embedTextsMock(...args),
  toPgVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import {
  createMemory,
  updateMemory,
  getMemory,
  getMemoriesByIds,
  getMemoryAsOf,
  supersede,
  contradict,
  link,
  getLineage,
} from "@/lib/memory/store";

const BASE_ROW = {
  id: "mem-1",
  user_id: "user-1",
  content: "rent is $1200/mo",
  summary: "",
  metadata: {},
  tags: [],
  source: "gmail",
  status: "active",
  occurred_at: new Date("2026-01-01T00:00:00Z"),
  created_at: new Date("2026-01-01T00:00:00Z"),
  updated_at: new Date("2026-01-01T00:00:00Z"),
  content_sha256: "abc123",
  version: 1,
};

describe("createMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chunkTextMock.mockReturnValue([{ index: 0, text: "rent is $1200/mo" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);
  });

  it("returns created:false and the existing row when an active duplicate exists (dedup by hash)", async () => {
    queryMock.mockResolvedValueOnce({ rows: [BASE_ROW] }); // dedup SELECT

    const result = await createMemory("user-1", { content: BASE_ROW.content });

    expect(result.created).toBe(false);
    expect(result.memory.id).toBe("mem-1");
    expect(chunkTextMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("inserts the memory, chunks it, embeds it, and opens a version row when no duplicate exists", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // dedup SELECT: none
      .mockResolvedValueOnce({ rows: [BASE_ROW] }) // INSERT INTO memories
      .mockResolvedValueOnce({ rows: [] }) // INSERT INTO memory_chunks
      .mockResolvedValueOnce({ rows: [] }); // INSERT INTO memory_versions

    const result = await createMemory("user-1", { content: BASE_ROW.content, source: "gmail" });

    expect(result.created).toBe(true);
    expect(chunkTextMock).toHaveBeenCalledWith(BASE_ROW.content);
    expect(embedTextsMock).toHaveBeenCalledWith(["rent is $1200/mo"]);

    const chunkInsert = queryMock.mock.calls[2];
    expect(chunkInsert[0]).toMatch(/INSERT INTO memory_chunks/);
    expect(chunkInsert[1]).toEqual(["mem-1", "user-1", 0, "rent is $1200/mo", "[0.1,0.2]"]);

    const versionInsert = queryMock.mock.calls[3];
    expect(versionInsert[0]).toMatch(/INSERT INTO memory_versions/);
  });

  it("skips embedding and chunk insertion when chunkText returns no chunks", async () => {
    chunkTextMock.mockReturnValue([]);
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [BASE_ROW] })
      .mockResolvedValueOnce({ rows: [] }); // version insert only

    await createMemory("user-1", { content: BASE_ROW.content });

    expect(embedTextsMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(3);
  });
});

describe("updateMemory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chunkTextMock.mockReturnValue([{ index: 0, text: "rent is $1300/mo" }]);
    embedTextsMock.mockResolvedValue([[0.3, 0.4]]);
  });

  it("throws when the memory does not exist for this user", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(updateMemory("user-1", "missing", { summary: "x" })).rejects.toThrow(
      /not found/,
    );
  });

  it("closes the open version row, bumps version, and does not touch chunks when content is unchanged", async () => {
    const updatedRow = { ...BASE_ROW, version: 2, summary: "updated" };
    queryMock
      .mockResolvedValueOnce({ rows: [BASE_ROW] }) // SELECT current
      .mockResolvedValueOnce({ rows: [] }) // close version
      .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE memories
      .mockResolvedValueOnce({ rows: [] }); // INSERT new version

    const result = await updateMemory("user-1", "mem-1", { summary: "updated" });

    expect(result.version).toBe(2);
    expect(queryMock.mock.calls[1][0]).toMatch(/UPDATE memory_versions SET valid_to = now/);
    expect(queryMock).toHaveBeenCalledTimes(4);
    expect(chunkTextMock).not.toHaveBeenCalled();
  });

  it("re-chunks and re-embeds when content changes", async () => {
    const updatedRow = { ...BASE_ROW, version: 2, content: "rent is $1300/mo" };
    queryMock
      .mockResolvedValueOnce({ rows: [BASE_ROW] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [updatedRow] })
      .mockResolvedValueOnce({ rows: [] }) // version insert
      .mockResolvedValueOnce({ rows: [] }) // DELETE old chunks
      .mockResolvedValueOnce({ rows: [] }); // INSERT new chunk

    await updateMemory("user-1", "mem-1", { content: "rent is $1300/mo" });

    expect(queryMock.mock.calls[4][0]).toMatch(/DELETE FROM memory_chunks/);
    expect(chunkTextMock).toHaveBeenCalledWith("rent is $1300/mo");
    expect(embedTextsMock).toHaveBeenCalled();
  });
});

describe("getMemory / getMemoriesByIds / getMemoryAsOf", () => {
  beforeEach(() => vi.clearAllMocks());

  it("getMemory returns null when not found", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getMemory("user-1", "missing")).toBeNull();
  });

  it("getMemory maps a found row", async () => {
    queryMock.mockResolvedValueOnce({ rows: [BASE_ROW] });
    const memory = await getMemory("user-1", "mem-1");
    expect(memory?.id).toBe("mem-1");
  });

  it("getMemoriesByIds returns [] without querying for an empty id list", async () => {
    const result = await getMemoriesByIds("user-1", []);
    expect(result).toEqual([]);
    expect(withUserScopeMock).not.toHaveBeenCalled();
  });

  it("getMemoryAsOf returns null when no version covers that instant", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    expect(await getMemoryAsOf("user-1", "mem-1", new Date())).toBeNull();
  });
});

describe("supersede / contradict / link", () => {
  beforeEach(() => vi.clearAllMocks());

  it("supersede inserts a supersedes edge and flips the old memory to superseded", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await supersede("user-1", "mem-new", "mem-old", "renewed");

    const edgeInsert = queryMock.mock.calls[0];
    expect(edgeInsert[0]).toMatch(/INSERT INTO memory_relations/);
    expect(edgeInsert[1]).toEqual(["user-1", "mem-new", "mem-old", "supersedes", "renewed"]);

    const statusUpdate = queryMock.mock.calls[1];
    expect(statusUpdate[0]).toMatch(/status = 'superseded'/);
    expect(statusUpdate[1]).toEqual(["mem-old", "user-1"]);
  });

  it("contradict inserts edges in both directions and touches no status", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await contradict("user-1", "mem-a", "mem-b", "disagreement");

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][1]).toEqual(["user-1", "mem-a", "mem-b", "contradicts", "disagreement"]);
    expect(queryMock.mock.calls[1][1]).toEqual(["user-1", "mem-b", "mem-a", "contradicts", "disagreement"]);
  });

  it("link inserts a single directed edge", async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await link("user-1", "mem-claim", "mem-source", "derived_from", "extracted");

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([
      "user-1",
      "mem-claim",
      "mem-source",
      "derived_from",
      "extracted",
    ]);
  });
});

describe("getLineage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports isCurrent:true and head:self when nothing supersedes it and it supersedes nothing", async () => {
    queryMock.mockResolvedValue({ rows: [] }); // both ancestor and successor walks empty

    const lineage = await getLineage("user-1", "mem-1");

    expect(lineage).toEqual({
      memoryId: "mem-1",
      ancestors: [],
      successors: [],
      isCurrent: true,
      head: "mem-1",
    });
  });

  it("walks the successor chain transitively and reports the final head", async () => {
    // ancestors walk (source_id = mem-1) -> none
    // successors walk (target_id = mem-1) -> mem-2 -> mem-3 -> none
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // ancestors: none
      .mockResolvedValueOnce({ rows: [{ next_id: "mem-2" }] }) // successors hop 1
      .mockResolvedValueOnce({ rows: [{ next_id: "mem-3" }] }) // successors hop 2
      .mockResolvedValueOnce({ rows: [] }); // successors: no further hop

    const lineage = await getLineage("user-1", "mem-1");

    expect(lineage.isCurrent).toBe(false);
    expect(lineage.successors).toEqual(["mem-2", "mem-3"]);
    expect(lineage.head).toBe("mem-3");
  });

  it("stops walking rather than looping forever if a cycle is found", async () => {
    // successors: mem-1 -> mem-2 -> mem-1 (cycle) -> should stop, not hang
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // ancestors: none
      .mockResolvedValueOnce({ rows: [{ next_id: "mem-2" }] })
      .mockResolvedValueOnce({ rows: [{ next_id: "mem-1" }] }); // cycles back

    const lineage = await getLineage("user-1", "mem-1");

    expect(lineage.successors).toEqual(["mem-2"]);
  });
});
