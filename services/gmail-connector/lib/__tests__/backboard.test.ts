// Adapted from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/backboard.test.ts (commit 55eedf7) — only the @/lib/db
// mock shape changed (named `pool` export here, not `default`).
import { describe, expect, it, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

import {
  createAssistant,
  addMemory,
  listMemories,
  searchMemories,
  getMemory,
  deleteMemory,
  ensureBackboardAssistant,
} from "@/lib/backboard";

const ORIGINAL_ENV = { ...process.env };

describe("backboard client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, BACKBOARD_API_KEY: "test-key" };
  });

  it("throws when BACKBOARD_API_KEY is unset", async () => {
    delete process.env.BACKBOARD_API_KEY;
    vi.stubGlobal("fetch", vi.fn());
    await expect(createAssistant("x")).rejects.toThrow(/BACKBOARD_API_KEY/);
    vi.unstubAllGlobals();
  });

  it("createAssistant sends the right method, headers, and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        assistant_id: "asst-1",
        name: "vouch-user-1",
        created_at: "2026-01-01T00:00:00Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const assistant = await createAssistant("vouch-user-1", "system prompt");

    expect(assistant).toEqual({
      assistantId: "asst-1",
      name: "vouch-user-1",
      createdAt: "2026-01-01T00:00:00Z",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.backboard.io/api/assistants");
    expect(init.method).toBe("POST");
    expect(init.headers["X-API-Key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({ name: "vouch-user-1", system_prompt: "system prompt" });

    vi.unstubAllGlobals();
  });

  it("addMemory posts content and metadata to the assistant's memories endpoint", async () => {
    // The real POST /memories response shape, confirmed against the live API:
    // {success, message, memory_id, content} -- NOT the {id, content, ...}
    // shape GET/list/search return. A mock using `id` here would silently
    // mask the memory_id-vs-id bug that made every addMemory() call return
    // `undefined` for its id.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: "Memory added successfully",
        memory_id: "mem_1",
        content: "rent paid",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const memory = await addMemory("asst-1", "rent paid", { merchant: "entrata" });

    expect(memory.id).toBe("mem_1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.backboard.io/api/assistants/asst-1/memories");
    expect(JSON.parse(init.body)).toEqual({ content: "rent paid", metadata: { merchant: "entrata" } });

    vi.unstubAllGlobals();
  });

  it("truncates ASCII content over 4096 bytes before sending (Backboard 500s past that length)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const longContent = "a".repeat(5000);
    await addMemory("asst-1", longContent);

    const [, init] = fetchMock.mock.calls[0];
    const sentContent = JSON.parse(init.body).content as string;
    expect(Buffer.byteLength(sentContent, "utf8")).toBe(4096);
    expect(sentContent.endsWith("…")).toBe(true);

    vi.unstubAllGlobals();
  });

  it("does not touch ASCII content at or under the 4096 byte limit", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const exactContent = "a".repeat(4096);
    await addMemory("asst-1", exactContent);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).content).toBe(exactContent);

    vi.unstubAllGlobals();
  });

  it("caps by UTF-8 byte length, not character count, for multi-byte content", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // "→" is 1 JS character but 3 UTF-8 bytes. 4090 chars + 3-byte char = 4093
    // JS chars but 4092 bytes, well under the byte cap; repeating the
    // multi-byte char enough times pushes byte length over 4096 while
    // character length stays far below it.
    const longMultiByteContent = "→".repeat(2000); // 2000 chars, 6000 bytes
    await addMemory("asst-1", longMultiByteContent);

    const [, init] = fetchMock.mock.calls[0];
    const sentContent = JSON.parse(init.body).content as string;
    expect(Buffer.byteLength(sentContent, "utf8")).toBeLessThanOrEqual(4096);
    expect(sentContent.endsWith("…")).toBe(true);
    // Never splits a multi-byte character mid-sequence into a replacement char.
    expect(sentContent).not.toContain("�");

    vi.unstubAllGlobals();
  });

  it("converts non-integer float metadata values to strings (Backboard 500s on raw floats)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await addMemory("asst-1", "test", { similarity: 0.528, amountCents: 2500, merchant: "Canva" });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).metadata).toEqual({
      similarity: "0.528",
      amountCents: 2500,
      merchant: "Canva",
    });

    vi.unstubAllGlobals();
  });

  it("leaves metadata untouched when there are no non-integer floats", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await addMemory("asst-1", "test", { amountCents: 2500, merchant: null });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).metadata).toEqual({ amountCents: 2500, merchant: null });

    vi.unstubAllGlobals();
  });

  it("passes metadata through as undefined when none is given", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "x" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await addMemory("asst-1", "test");

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).metadata).toBeUndefined();

    vi.unstubAllGlobals();
  });

  it("listMemories appends page/page_size as query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memories: [], total_count: 0, page: 2, page_size: 10, total_pages: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await listMemories("asst-1", { page: 2, pageSize: 10 });

    expect(result).toEqual({ memories: [], totalCount: 0, page: 2, pageSize: 10, totalPages: 1 });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.backboard.io/api/assistants/asst-1/memories?page=2&page_size=10");

    vi.unstubAllGlobals();
  });

  it("searchMemories posts query/limit and maps results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        memories: [{ id: "mem_1", content: "rent paid", score: 0.9, created_at: "2026-01-01T00:00:00Z" }],
        total_count: 1,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchMemories("asst-1", "rent", 10);

    expect(result.totalCount).toBe(1);
    expect(result.memories[0]).toEqual({
      id: "mem_1",
      content: "rent paid",
      metadata: null,
      score: 0.9,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: null,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://app.backboard.io/api/assistants/asst-1/memories/search");
    expect(JSON.parse(init.body)).toEqual({ query: "rent", limit: 10 });

    vi.unstubAllGlobals();
  });

  it("getMemory fetches a single memory by id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "mem_1", content: "rent paid" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const memory = await getMemory("asst-1", "mem_1");

    expect(memory.id).toBe("mem_1");
    expect(fetchMock.mock.calls[0][0]).toBe("https://app.backboard.io/api/assistants/asst-1/memories/mem_1");

    vi.unstubAllGlobals();
  });

  it("deleteMemory sends a DELETE request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await deleteMemory("asst-1", "mem_1");

    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");

    vi.unstubAllGlobals();
  });

  it("throws with the response body when a request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Invalid or missing API key",
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(createAssistant("x")).rejects.toThrow(/Invalid or missing API key/);

    vi.unstubAllGlobals();
  });
});

describe("ensureBackboardAssistant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, BACKBOARD_API_KEY: "test-key" };
  });

  it("returns the cached assistant id without calling Backboard when one already exists", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ assistant_id: "asst-existing" }] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const assistantId = await ensureBackboardAssistant("user-1");

    expect(assistantId).toBe("asst-existing");
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("creates and persists a new assistant when none exists yet", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // no existing mapping
      .mockResolvedValueOnce({ rows: [{ assistant_id: "asst-new" }] }); // insert ... returning
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ assistant_id: "asst-new", name: "vouch-user-1", created_at: "2026-01-01T00:00:00Z" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const assistantId = await ensureBackboardAssistant("user-1");

    expect(assistantId).toBe("asst-new");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const insertCall = queryMock.mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO backboard_assistants/);
    expect(insertCall[1]).toEqual(["user-1", "asst-new"]);

    vi.unstubAllGlobals();
  });
});
