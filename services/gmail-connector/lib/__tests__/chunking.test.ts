// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/chunking.test.ts (commit 55eedf7).
import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunking";

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("Your DoorDash order has been delivered. Total: $24.50");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({
      index: 0,
      text: "Your DoorDash order has been delivered. Total: $24.50",
    });
  });

  it("returns [] for empty or whitespace-only input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("splits long multi-paragraph text into multiple chunks near the target size", () => {
    const paragraph = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(20);
    const text = Array.from({ length: 6 }, () => paragraph).join("\n\n");

    const chunks = chunkText(text, { targetChars: 500, maxChunks: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Each chunk should roughly respect the target size (paragraphs aren't split unless oversized).
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThan(1200);
    }
  });

  it("hard-splits a single oversized paragraph with no blank-line breaks", () => {
    const longSentence = "word ".repeat(500).trim() + ".";
    const chunks = chunkText(longSentence, { targetChars: 200, maxChunks: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(210);
    }
  });

  it("never exceeds maxChunks, merging down when necessary", () => {
    const paragraph = "Some paragraph content that takes up a bit of space here.";
    const text = Array.from({ length: 30 }, () => paragraph).join("\n\n");

    const chunks = chunkText(text, { targetChars: 80, maxChunks: 5 });

    expect(chunks.length).toBeLessThanOrEqual(5);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });
});
