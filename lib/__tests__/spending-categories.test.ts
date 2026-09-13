// Adapted from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/spending-categories.test.ts (commit 55eedf7) — only the
// @/lib/db mock shape changed (named `pool` export here, not `default`).
import { describe, expect, it, beforeEach, vi } from "vitest";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const embedTextsMock = vi.fn();
vi.mock("@/lib/embeddings", () => ({
  embedTexts: (...args: unknown[]) => embedTextsMock(...args),
  toPgVectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import {
  ensurePrototypeEmbeddings,
  classifyEmbedding,
  upsertClassification,
} from "@/lib/spending-categories";

describe("ensurePrototypeEmbeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("embeds and persists only rows missing a prototype embedding", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [
        { key: "a", description: "desc a", prototype_embedding: null },
        { key: "b", description: "desc b", prototype_embedding: "[0.1,0.2]" },
        { key: "c", description: "desc c", prototype_embedding: null },
      ],
    });
    embedTextsMock.mockResolvedValue([[1, 2], [3, 4]]);
    queryMock.mockResolvedValue({ rows: [] }); // subsequent UPDATE calls

    await ensurePrototypeEmbeddings();

    expect(embedTextsMock).toHaveBeenCalledWith(["desc a", "desc c"]);
    // 1 SELECT + 2 UPDATEs
    expect(queryMock).toHaveBeenCalledTimes(3);
    expect(queryMock.mock.calls[1][0]).toMatch(/UPDATE spending_categories/);
    expect(queryMock.mock.calls[1][1]).toEqual(["[1,2]", "a"]);
    expect(queryMock.mock.calls[2][1]).toEqual(["[3,4]", "c"]);
  });

  it("does nothing when all rows already have a prototype embedding", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ key: "a", description: "desc a", prototype_embedding: "[0.1]" }],
    });

    await ensurePrototypeEmbeddings();

    expect(embedTextsMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
  });
});

describe("classifyEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries nearest category by cosine distance and returns the top match", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ key: "active_subscription_usage", label: "Subscriptions actively in use", similarity: 0.87 }],
    });

    const match = await classifyEmbedding([0.1, 0.2, 0.3]);

    expect(match).toEqual({
      key: "active_subscription_usage",
      label: "Subscriptions actively in use",
      similarity: 0.87,
    });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/ORDER BY prototype_embedding <=> \$1::vector/);
    expect(sql).toMatch(/WHERE prototype_embedding IS NOT NULL/);
    expect(params).toEqual(["[0.1,0.2,0.3]"]);
  });

  it("throws when no category has a prototype embedding yet", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    await expect(classifyEmbedding([0.1])).rejects.toThrow(
      /ensurePrototypeEmbeddings/,
    );
  });
});

describe("upsertClassification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts on conflict by message_id", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    await upsertClassification("msg-1", {
      key: "general_spending_habit",
      label: "General spending habit monitoring",
      similarity: 0.5,
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/ON CONFLICT \(message_id\) DO UPDATE/);
    expect(params).toEqual(["msg-1", "general_spending_habit", 0.5]);
  });
});
