// Adapted from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/gmail-sync.test.ts (commit 55eedf7) — only the @/lib/db
// mock shape changed (named `pool` export here, not `default`).
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { computeWatermark } from "@/lib/gmail-sync";

const getGmailClientForUserMock = vi.fn();
vi.mock("@/lib/google", () => ({
  getGmailClientForUser: (...args: unknown[]) => getGmailClientForUserMock(...args),
}));

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const embedTextsMock = vi.fn();
const meanPoolMock = vi.fn((vectors: number[][]) => vectors[0] ?? []);
vi.mock("@/lib/embeddings", () => ({
  embedTexts: (...args: unknown[]) => embedTextsMock(...args),
  meanPool: (...args: [number[][]]) => meanPoolMock(...args),
  toPgVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const ensurePrototypeEmbeddingsMock = vi.fn();
const classifyEmbeddingMock = vi.fn();
const upsertClassificationMock = vi.fn();
vi.mock("@/lib/spending-categories", () => ({
  ensurePrototypeEmbeddings: (...args: unknown[]) => ensurePrototypeEmbeddingsMock(...args),
  classifyEmbedding: (...args: unknown[]) => classifyEmbeddingMock(...args),
  upsertClassification: (...args: unknown[]) => upsertClassificationMock(...args),
}));

const extractPlainTextBodyMock = vi.fn();
const extractHeaderMock = vi.fn();
const extractMerchantMock = vi.fn();
const extractAmountCentsMock = vi.fn();
vi.mock("@/lib/gmail-body", () => ({
  extractPlainTextBody: (...args: unknown[]) => extractPlainTextBodyMock(...args),
  extractHeader: (...args: unknown[]) => extractHeaderMock(...args),
  extractMerchant: (...args: unknown[]) => extractMerchantMock(...args),
  extractAmountCents: (...args: unknown[]) => extractAmountCentsMock(...args),
}));

const chunkTextMock = vi.fn();
vi.mock("@/lib/chunking", () => ({
  chunkText: (...args: unknown[]) => chunkTextMock(...args),
}));

const createMemoryMock = vi.fn();
vi.mock("@/lib/memory/store", () => ({
  createMemory: (...args: unknown[]) => createMemoryMock(...args),
}));

const ensureBackboardAssistantMock = vi.fn();
const addBackboardMemoryMock = vi.fn();
vi.mock("@/lib/backboard", () => ({
  ensureBackboardAssistant: (...args: unknown[]) => ensureBackboardAssistantMock(...args),
  addMemory: (...args: unknown[]) => addBackboardMemoryMock(...args),
}));

import { syncGmailForUser } from "@/lib/gmail-sync";

function makeGmailClient(overrides: {
  list?: ReturnType<typeof vi.fn>;
  get?: ReturnType<typeof vi.fn>;
}) {
  return {
    email: "user@gmail.com",
    gmail: {
      users: {
        messages: {
          list: overrides.list ?? vi.fn(),
          get: overrides.get ?? vi.fn(),
        },
      },
    },
  };
}

describe("computeWatermark", () => {
  it("falls back to sinceUnixSeconds when there are no received timestamps", () => {
    expect(computeWatermark(1000, [])).toBe(1000);
  });

  it("uses the max received timestamp minus the overlap, floored at sinceUnixSeconds", () => {
    const receivedMs = [2_000_000_000 * 1000]; // an arbitrary large timestamp
    const result = computeWatermark(1000, receivedMs, 3600);
    expect(result).toBe(2_000_000_000 - 3600);
  });

  it("never returns less than sinceUnixSeconds", () => {
    const receivedMs = [500 * 1000]; // received "before" the since cutoff once overlap is subtracted
    const result = computeWatermark(1000, receivedMs, 3600);
    expect(result).toBe(1000);
  });
});

describe("syncGmailForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensurePrototypeEmbeddingsMock.mockResolvedValue(undefined);
    extractHeaderMock.mockReturnValue(null);
    extractMerchantMock.mockReturnValue(null);
    extractAmountCentsMock.mockReturnValue(null);
    extractPlainTextBodyMock.mockReturnValue("some body text");
    classifyEmbeddingMock.mockResolvedValue({
      key: "general_spending_habit",
      label: "General spending habit monitoring",
      similarity: 0.5,
    });
    upsertClassificationMock.mockResolvedValue(undefined);
    queryMock.mockResolvedValue({ rows: [{ id: "row-id" }] });
    createMemoryMock.mockResolvedValue({ created: true, memory: { id: "mem-id" } });
  });

  it("returns a no-op result when the user has no Gmail connection", async () => {
    getGmailClientForUserMock.mockResolvedValue(null);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(result.connected).toBe(false);
    expect(result.fetched).toBe(0);
    expect(ensurePrototypeEmbeddingsMock).not.toHaveBeenCalled();
  });

  it("paginates through multiple pages until nextPageToken is exhausted", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: { messages: [{ id: "m1" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { messages: [{ id: "m2" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(list).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.fetched).toBe(2);
    expect(result.imported).toBe(2);
  });

  it("stops fetching further pages once maxMessages is reached", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ data: { messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" } })
      .mockResolvedValueOnce({ data: { messages: [{ id: "m3" }], nextPageToken: "p3" } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000, maxMessages: 2 });

    // Page 1 alone already yields 2 ids (== maxMessages), so page 2 is never fetched.
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.fetched).toBe(2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("upserts the message row idempotently via ON CONFLICT on re-sync", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);

    await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    const insertCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO gmail_messages"),
    );
    expect(insertCall?.[0]).toMatch(/ON CONFLICT \(user_id, gmail_message_id\) DO UPDATE/);
  });

  it("inserts a message with chunk_count 0 and skips embedding/classification when the body has no chunks", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([]);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(embedTextsMock).not.toHaveBeenCalled();
    expect(classifyEmbeddingMock).not.toHaveBeenCalled();
    expect(result.skippedEmptyBody).toBe(1);
    expect(result.imported).toBe(1);
    expect(result.classified).toBe(0);
  });

  it("isolates a per-message failure: continues the batch and records the error", async () => {
    const list = vi.fn().mockResolvedValue({
      data: { messages: [{ id: "bad" }, { id: "good" }], nextPageToken: undefined },
    });
    const get = vi.fn().mockImplementation(({ id }: { id: string }) => {
      if (id === "bad") return Promise.reject(new Error("Gmail API error"));
      return Promise.resolve({
        data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
      });
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.1, 0.2]]);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(result.errors).toEqual([{ gmailMessageId: "bad", error: "Gmail API error" }]);
    expect(result.imported).toBe(1);
    // last_synced_at should still be updated once at the end despite the failure
    const updateCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE gmail_connections"),
    );
    expect(updateCall).toBeDefined();
  });

  it("classifies each successfully imported message with its mean-pooled embedding", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
    meanPoolMock.mockReturnValue([0.9, 0.1]);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(classifyEmbeddingMock).toHaveBeenCalledWith([0.9, 0.1]);
    expect(upsertClassificationMock).toHaveBeenCalledWith("row-id", {
      key: "general_spending_habit",
      label: "General spending habit monitoring",
      similarity: 0.5,
    });
    expect(result.classified).toBe(1);
  });

  it("pushes each classified message into the memory subsystem with category tag and metadata", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
    extractMerchantMock.mockReturnValue("Canva");
    extractAmountCentsMock.mockReturnValue(2500);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(createMemoryMock).toHaveBeenCalledWith("user-1", {
      content: "some body text",
      source: "gmail",
      tags: ["general_spending_habit"],
      metadata: {
        gmailMessageId: "m1",
        merchant: "Canva",
        amountCents: 2500,
        categoryKey: "general_spending_habit",
        similarity: 0.5,
      },
      occurredAt: new Date(1700000000000),
    });
    expect(result.memoriesWritten).toBe(1);
  });

  it("does not push a memory for a zero-chunk (empty body) message", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([]);

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(createMemoryMock).not.toHaveBeenCalled();
    expect(result.memoriesWritten).toBe(0);
  });

  it("records a memory-write failure as a non-fatal error without discarding the gmail import", async () => {
    const list = vi
      .fn()
      .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
    const get = vi.fn().mockResolvedValue({
      data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
    });
    getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
    chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
    embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
    createMemoryMock.mockRejectedValue(new Error("Vertex AI is down"));

    const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

    expect(result.imported).toBe(1);
    expect(result.classified).toBe(1);
    expect(result.memoriesWritten).toBe(0);
    expect(result.errors).toEqual([
      { gmailMessageId: "m1", error: "memory write failed: Vertex AI is down" },
    ]);
  });

  describe("Backboard integration", () => {
    const ORIGINAL_BACKBOARD_KEY = process.env.BACKBOARD_API_KEY;

    afterEach(() => {
      if (ORIGINAL_BACKBOARD_KEY === undefined) {
        delete process.env.BACKBOARD_API_KEY;
      } else {
        process.env.BACKBOARD_API_KEY = ORIGINAL_BACKBOARD_KEY;
      }
    });

    it("skips Backboard entirely when BACKBOARD_API_KEY is unset", async () => {
      delete process.env.BACKBOARD_API_KEY;
      const list = vi
        .fn()
        .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
      const get = vi.fn().mockResolvedValue({
        data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
      });
      getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
      chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
      embedTextsMock.mockResolvedValue([[0.9, 0.1]]);

      const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

      expect(ensureBackboardAssistantMock).not.toHaveBeenCalled();
      expect(addBackboardMemoryMock).not.toHaveBeenCalled();
      expect(result.backboardMemoriesWritten).toBe(0);
    });

    it("pushes a classified message into Backboard when BACKBOARD_API_KEY is set", async () => {
      process.env.BACKBOARD_API_KEY = "test-key";
      const list = vi
        .fn()
        .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
      const get = vi.fn().mockResolvedValue({
        data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
      });
      getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
      chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
      embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
      extractMerchantMock.mockReturnValue("Canva");
      extractAmountCentsMock.mockReturnValue(2500);
      ensureBackboardAssistantMock.mockResolvedValue("asst-1");
      addBackboardMemoryMock.mockResolvedValue({ id: "mem_1" });

      const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

      expect(ensureBackboardAssistantMock).toHaveBeenCalledWith("user-1");
      expect(addBackboardMemoryMock).toHaveBeenCalledWith("asst-1", "some body text", {
        gmailMessageId: "m1",
        merchant: "Canva",
        amountCents: 2500,
        categoryKey: "general_spending_habit",
        similarity: 0.5,
      });
      expect(result.backboardMemoriesWritten).toBe(1);
    });

    it("records a Backboard failure as non-fatal without discarding the local memory write", async () => {
      process.env.BACKBOARD_API_KEY = "test-key";
      const list = vi
        .fn()
        .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
      const get = vi.fn().mockResolvedValue({
        data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
      });
      getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
      chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
      embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
      ensureBackboardAssistantMock.mockRejectedValue(new Error("Invalid or missing API key"));

      const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

      expect(result.memoriesWritten).toBe(1); // local memory write still succeeded
      expect(result.backboardMemoriesWritten).toBe(0);
      expect(result.errors).toEqual([
        { gmailMessageId: "m1", error: "backboard write failed: Invalid or missing API key" },
      ]);
    });

    it("records the returned Backboard memory id on gmail_messages after a successful push", async () => {
      process.env.BACKBOARD_API_KEY = "test-key";
      const list = vi
        .fn()
        .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
      const get = vi.fn().mockResolvedValue({
        data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
      });
      getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
      chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
      embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
      ensureBackboardAssistantMock.mockResolvedValue("asst-1");
      addBackboardMemoryMock.mockResolvedValue({ id: "mem_backboard_1" });

      await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

      const updateCall = queryMock.mock.calls.find(([sql]) =>
        String(sql).includes("UPDATE gmail_messages SET backboard_memory_id"),
      );
      expect(updateCall?.[1]).toEqual(["mem_backboard_1", "user-1", "m1"]);
    });

    it("skips re-pushing to Backboard when the message already has a backboard_memory_id", async () => {
      process.env.BACKBOARD_API_KEY = "test-key";
      const list = vi
        .fn()
        .mockResolvedValue({ data: { messages: [{ id: "m1" }], nextPageToken: undefined } });
      const get = vi.fn().mockResolvedValue({
        data: { threadId: "t1", internalDate: "1700000000000", payload: {} },
      });
      getGmailClientForUserMock.mockResolvedValue(makeGmailClient({ list, get }));
      chunkTextMock.mockReturnValue([{ index: 0, text: "chunk" }]);
      embedTextsMock.mockResolvedValue([[0.9, 0.1]]);
      queryMock.mockImplementation((sql: string) => {
        if (String(sql).includes("SELECT backboard_memory_id")) {
          return Promise.resolve({ rows: [{ backboard_memory_id: "mem_already_pushed" }] });
        }
        return Promise.resolve({ rows: [{ id: "row-id" }] });
      });

      const result = await syncGmailForUser("user-1", { sinceUnixSeconds: 1000 });

      expect(ensureBackboardAssistantMock).not.toHaveBeenCalled();
      expect(addBackboardMemoryMock).not.toHaveBeenCalled();
      expect(result.backboardMemoriesWritten).toBe(0);
      expect(result.backboardMemoriesSkipped).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });
});
