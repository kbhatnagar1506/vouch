// Adapted from aaditisinghal/vouch-aaditi's
// src/app/api/connectors/gmail/status/__tests__/route.test.ts (commit
// 55eedf7). This route uses @/lib/session's requireUser()/UnauthorizedError
// (not a manual verifySession()+cookie check) and a named `pool` export
// from @/lib/db.
import { describe, expect, it, beforeEach, vi } from "vitest";

const requireUserMock = vi.fn();
class FakeUnauthorizedError extends Error {}
vi.mock("@/lib/session", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
  UnauthorizedError: FakeUnauthorizedError,
}));

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

describe("GET /api/connectors/gmail/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no valid session", async () => {
    requireUserMock.mockRejectedValue(new FakeUnauthorizedError("Not authenticated"));
    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not authenticated" });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns connected:false when no gmail_connections row exists", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockResolvedValue({ rows: [] });

    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      connected: false,
      email: null,
      connectedAt: null,
    });
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), ["user-1"]);
  });

  it("returns connected:true with the stored email and timestamp", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const connectedAt = "2026-01-01T00:00:00.000Z";
    queryMock.mockResolvedValue({
      rows: [{ google_email: "user@gmail.com", connected_at: connectedAt }],
    });

    const { GET } = await import("../route");
    const res = await GET();

    expect(await res.json()).toEqual({
      connected: true,
      email: "user@gmail.com",
      connectedAt,
    });
  });
});
