// Ported verbatim from aaditisinghal/vouch-aaditi's
// src/lib/__tests__/embeddings.test.ts (commit 55eedf7).
import { describe, expect, it, beforeEach, vi } from "vitest";

const getAccessTokenMock = vi.fn();
const getClientMock = vi.fn(() => ({ getAccessToken: getAccessTokenMock }));
const GoogleAuthMock = vi.fn().mockImplementation(() => ({
  getClient: getClientMock,
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: GoogleAuthMock,
}));

describe("embedTexts", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    process.env.GOOGLE_CLOUD_PROJECT = "test-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
    getAccessTokenMock.mockResolvedValue({ token: "fake-access-token" });
  });

  it("returns [] without calling fetch for an empty input", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { embedTexts } = await import("@/lib/embeddings");
    const result = await embedTexts([]);

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when GOOGLE_CLOUD_PROJECT or GOOGLE_CLOUD_LOCATION is missing", async () => {
    delete process.env.GOOGLE_CLOUD_PROJECT;
    const { embedTexts } = await import("@/lib/embeddings");
    await expect(embedTexts(["hello"])).rejects.toThrow(
      /GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION/,
    );
  });

  it("sends a single batched request and parses embeddings back in order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        predictions: [
          { embeddings: { values: [0.1, 0.2] } },
          { embeddings: { values: [0.3, 0.4] } },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { embedTexts } = await import("@/lib/embeddings");
    const result = await embedTexts(["first chunk", "second chunk"]);

    expect(result).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/publishers/google/models/text-embedding-004:predict",
    );
    expect(init.headers.Authorization).toBe("Bearer fake-access-token");
    const body = JSON.parse(init.body);
    expect(body.instances).toEqual([
      { content: "first chunk" },
      { content: "second chunk" },
    ]);
  });

  it("throws with the response body when the request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "quota exceeded",
    });
    vi.stubGlobal("fetch", fetchMock);

    const { embedTexts } = await import("@/lib/embeddings");
    await expect(embedTexts(["hello"])).rejects.toThrow(/quota exceeded/);
  });

  it("throws when no access token is returned", async () => {
    getAccessTokenMock.mockResolvedValue({ token: undefined });
    vi.stubGlobal("fetch", vi.fn());

    const { embedTexts } = await import("@/lib/embeddings");
    await expect(embedTexts(["hello"])).rejects.toThrow(/access token/);
  });
});

describe("meanPool", () => {
  it("returns [] for an empty array", async () => {
    const { meanPool } = await import("@/lib/embeddings");
    expect(meanPool([])).toEqual([]);
  });

  it("returns the same vector when given a single vector", async () => {
    const { meanPool } = await import("@/lib/embeddings");
    const v = [1, 2, 3];
    expect(meanPool([v])).toBe(v);
  });

  it("averages multiple vectors elementwise", async () => {
    const { meanPool } = await import("@/lib/embeddings");
    expect(meanPool([[1, 2, 3], [3, 4, 5]])).toEqual([2, 3, 4]);
  });
});

describe("toPgVectorLiteral", () => {
  it("formats a vector as a pgvector literal string", async () => {
    const { toPgVectorLiteral } = await import("@/lib/embeddings");
    expect(toPgVectorLiteral([1, 0.5, -2])).toBe("[1,0.5,-2]");
  });
});
