// Adapted from aaditisinghal/vouch-aaditi's
// src/lib/memory/__tests__/tenant.test.ts (commit 55eedf7) — only the
// @/lib/db mock shape changed (named `pool` export here, not `default`).
import { describe, expect, it, vi, beforeEach } from "vitest";

const queryMock = vi.fn();
const releaseMock = vi.fn();
const connectMock = vi.fn(() => ({ query: queryMock, release: releaseMock }));
vi.mock("@/lib/db", () => ({
  pool: { connect: () => connectMock() },
}));

import { withUserScope } from "@/lib/memory/tenant";

describe("withUserScope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockResolvedValue({ rows: [] });
  });

  it("runs BEGIN, sets app.user_id, then COMMIT, then releases the client", async () => {
    const fn = vi.fn().mockResolvedValue("result");

    const result = await withUserScope("user-1", fn);

    expect(result).toBe("result");
    expect(queryMock.mock.calls[0]).toEqual(["BEGIN"]);
    expect(queryMock.mock.calls[1]).toEqual([
      "SELECT set_config('app.user_id', $1, true)",
      ["user-1"],
    ]);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ query: queryMock }));
    expect(queryMock.mock.calls[2]).toEqual(["COMMIT"]);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("rolls back and releases when fn throws, and rethrows the error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(withUserScope("user-1", fn)).rejects.toThrow("boom");

    expect(queryMock.mock.calls[2]).toEqual(["ROLLBACK"]);
    expect(queryMock.mock.calls.some((c) => c[0] === "COMMIT")).toBe(false);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("releases the client even if COMMIT itself fails", async () => {
    queryMock.mockImplementation((sql: string) => {
      if (sql === "COMMIT") return Promise.reject(new Error("commit failed"));
      return Promise.resolve({ rows: [] });
    });

    await expect(withUserScope("user-1", async () => "x")).rejects.toThrow("commit failed");
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });
});
