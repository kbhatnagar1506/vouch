import { describe, expect, it } from "vitest";
import {
  formatMemoryTimestamp,
  isRetrievedMemory,
  parseMemorySearchResponse,
  toRetrievedMemory,
  type RetrievedMemory,
} from "@/lib/memory-schema";

// A realistic row as Backboard's POST /memories/search actually returns it,
// including the stringified float in metadata that gmail-connector's
// sanitizeMetadata() writes (see lib/memory-schema.ts for why).
function rawMemory(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem_01HZX",
    content: "Netflix charged $15.99 on Mar 3, 2026 — Premium plan renewal.",
    metadata: {
      merchant: "Netflix",
      category_key: "subscription_signup_renewal",
      similarity: "0.8271",
      amount_cents: 1599,
    },
    score: 0.91,
    created_at: "2026-03-03T09:14:22.000Z",
    updated_at: "2026-03-03T09:14:22.000Z",
    ...overrides,
  };
}

describe("toRetrievedMemory", () => {
  it("maps a full Backboard row onto the RetrievedMemory schema", () => {
    const memory = toRetrievedMemory(rawMemory());

    expect(memory).toEqual({
      id: "mem_01HZX",
      content: "Netflix charged $15.99 on Mar 3, 2026 — Premium plan renewal.",
      score: 0.91,
      createdAt: "2026-03-03T09:14:22.000Z",
      metadata: {
        merchant: "Netflix",
        category_key: "subscription_signup_renewal",
        similarity: "0.8271",
        amount_cents: "1599",
      },
    });
    expect(isRetrievedMemory(memory)).toBe(true);
  });

  it("passes content through byte for byte (no summarizing, truncating or rewriting)", () => {
    const content = "  Spotify   $11.99\n\nRenews 2026-04-01 — “Duo” plan · card •••• 4242  ";
    const memory = toRetrievedMemory(rawMemory({ content }));

    expect(memory?.content).toBe(content);
  });

  it("preserves a stringified float in metadata verbatim rather than re-parsing it", () => {
    // Backboard 500s on non-integer floats, so they're stored as strings.
    // Converting "0.8271" back to 0.8271 here would silently change the
    // stored value's type on its way to the UI.
    const memory = toRetrievedMemory(rawMemory({ metadata: { similarity: "0.8271" } }));

    expect(memory?.metadata.similarity).toBe("0.8271");
    expect(typeof memory?.metadata.similarity).toBe("string");
  });

  it("flattens non-string metadata values to displayable strings", () => {
    const memory = toRetrievedMemory(
      rawMemory({
        metadata: {
          count: 3,
          confirmed: true,
          tags: ["streaming", "monthly"],
          source: { kind: "gmail", id: "18f2" },
        },
      }),
    );

    expect(memory?.metadata).toEqual({
      count: "3",
      confirmed: "true",
      tags: '["streaming","monthly"]',
      source: '{"kind":"gmail","id":"18f2"}',
    });
    expect(isRetrievedMemory(memory)).toBe(true);
  });

  it("drops metadata keys whose value is null or undefined", () => {
    const memory = toRetrievedMemory(
      rawMemory({ metadata: { merchant: "Hulu", note: null, archived: undefined } }),
    );

    expect(memory?.metadata).toEqual({ merchant: "Hulu" });
    expect("note" in (memory?.metadata ?? {})).toBe(false);
  });

  it("defaults metadata to {} when absent, null, or not an object", () => {
    for (const metadata of [undefined, null, "nope", 42, ["a"]]) {
      const memory = toRetrievedMemory(rawMemory({ metadata }));
      expect(memory?.metadata).toEqual({});
      expect(isRetrievedMemory(memory)).toBe(true);
    }
  });

  it("nulls a missing, null, or non-finite score instead of guessing one", () => {
    for (const score of [undefined, null, "0.9", NaN, Infinity]) {
      expect(toRetrievedMemory(rawMemory({ score }))?.score).toBeNull();
    }
  });

  it("keeps created_at as the raw string and nulls blank or non-string values", () => {
    expect(toRetrievedMemory(rawMemory({ created_at: "2026-03-03" }))?.createdAt).toBe("2026-03-03");
    for (const created_at of [undefined, null, "", "   ", 1772000000]) {
      expect(toRetrievedMemory(rawMemory({ created_at }))?.createdAt).toBeNull();
    }
  });

  it("rejects a row with no usable id or no content", () => {
    expect(toRetrievedMemory(rawMemory({ id: undefined }))).toBeNull();
    expect(toRetrievedMemory(rawMemory({ id: "" }))).toBeNull();
    expect(toRetrievedMemory(rawMemory({ id: 123 }))).toBeNull();
    expect(toRetrievedMemory(rawMemory({ content: undefined }))).toBeNull();
    expect(toRetrievedMemory(rawMemory({ content: "" }))).toBeNull();
  });

  it("rejects non-object input instead of throwing", () => {
    for (const input of [null, undefined, "mem_1", 7, ["mem_1"]]) {
      expect(toRetrievedMemory(input)).toBeNull();
    }
  });
});

describe("parseMemorySearchResponse", () => {
  it("maps a search response and preserves Backboard's relevance ordering", () => {
    const result = parseMemorySearchResponse({
      memories: [
        rawMemory({ id: "mem_a", score: 0.93 }),
        rawMemory({ id: "mem_b", score: 0.71 }),
        rawMemory({ id: "mem_c", score: 0.44 }),
      ],
      total_count: 3,
    });

    expect(result.map((m) => m.id)).toEqual(["mem_a", "mem_b", "mem_c"]);
    expect(result.every(isRetrievedMemory)).toBe(true);
  });

  it("skips malformed rows without discarding the good ones", () => {
    const result = parseMemorySearchResponse({
      memories: [rawMemory({ id: "mem_a" }), { id: "mem_b" }, null, "junk", rawMemory({ id: "mem_c" })],
      total_count: 5,
    });

    expect(result.map((m) => m.id)).toEqual(["mem_a", "mem_c"]);
    expect(result.every(isRetrievedMemory)).toBe(true);
  });

  it("applies a top-k limit", () => {
    const memories = Array.from({ length: 10 }, (_, i) => rawMemory({ id: `mem_${i}` }));

    expect(parseMemorySearchResponse({ memories }, 3).map((m) => m.id)).toEqual(["mem_0", "mem_1", "mem_2"]);
    expect(parseMemorySearchResponse({ memories }, 0)).toEqual([]);
    expect(parseMemorySearchResponse({ memories })).toHaveLength(10);
    expect(parseMemorySearchResponse({ memories }, 50)).toHaveLength(10);
  });

  it("returns [] for an empty, malformed, or non-object response", () => {
    expect(parseMemorySearchResponse({ memories: [], total_count: 0 })).toEqual([]);
    expect(parseMemorySearchResponse({ total_count: 0 })).toEqual([]);
    expect(parseMemorySearchResponse({ memories: "none" })).toEqual([]);
    expect(parseMemorySearchResponse(null)).toEqual([]);
    expect(parseMemorySearchResponse(undefined)).toEqual([]);
    expect(parseMemorySearchResponse("error")).toEqual([]);
    expect(parseMemorySearchResponse([rawMemory()])).toEqual([]);
  });

  it("produces output that satisfies the schema for every row of a mixed real-world response", () => {
    const result = parseMemorySearchResponse({
      memories: [
        rawMemory({ id: "mem_full" }),
        rawMemory({ id: "mem_bare", metadata: undefined, score: null, created_at: null }),
        rawMemory({ id: "mem_weird", metadata: { nested: { a: [1, 2] }, flag: false, gone: null } }),
      ],
      total_count: 3,
    });

    expect(result).toHaveLength(3);
    for (const memory of result) {
      expect(isRetrievedMemory(memory)).toBe(true);
    }
  });
});

describe("formatMemoryTimestamp", () => {
  it("formats a Backboard timestamp in UTC regardless of the runtime's zone", () => {
    // 23:30Z is already the next day in +02:00 — pinning to UTC is what
    // keeps a server render and a client render from disagreeing.
    expect(formatMemoryTimestamp("2026-03-01T23:30:00.000Z")).toBe("Mar 1, 2026");
    expect(formatMemoryTimestamp("2026-03-01T00:30:00.000Z")).toBe("Mar 1, 2026");
    expect(formatMemoryTimestamp("2026-12-25")).toBe("Dec 25, 2026");
  });

  it("falls through to the raw string when the value isn't a parseable date", () => {
    expect(formatMemoryTimestamp("not a date")).toBe("not a date");
    expect(formatMemoryTimestamp("")).toBe("");
  });

  it("passes null through", () => {
    expect(formatMemoryTimestamp(null)).toBeNull();
  });
});

describe("isRetrievedMemory", () => {
  const valid: RetrievedMemory = {
    id: "mem_1",
    content: "Hulu $17.99 renewal",
    score: 0.5,
    createdAt: "2026-01-01T00:00:00Z",
    metadata: { merchant: "Hulu" },
  };

  it("accepts a valid memory, including null score/createdAt and empty metadata", () => {
    expect(isRetrievedMemory(valid)).toBe(true);
    expect(isRetrievedMemory({ ...valid, score: null, createdAt: null, metadata: {} })).toBe(true);
  });

  it("rejects anything that violates the contract", () => {
    expect(isRetrievedMemory({ ...valid, id: "" })).toBe(false);
    expect(isRetrievedMemory({ ...valid, content: 5 })).toBe(false);
    expect(isRetrievedMemory({ ...valid, score: "0.5" })).toBe(false);
    expect(isRetrievedMemory({ ...valid, score: NaN })).toBe(false);
    expect(isRetrievedMemory({ ...valid, createdAt: 1772000000 })).toBe(false);
    expect(isRetrievedMemory({ ...valid, metadata: null })).toBe(false);
    expect(isRetrievedMemory({ ...valid, metadata: { amount: 1599 } })).toBe(false);
    expect(isRetrievedMemory(null)).toBe(false);
  });
});
