// Adapted from aaditisinghal/vouch-aaditi's
// src/app/api/connectors/gmail/disconnect/__tests__/route.test.ts (commit
// 55eedf7). This route uses @/lib/session's requireUser()/UnauthorizedError
// (not a manual verifySession()+cookie check), a named `pool` export from
// @/lib/db, and decryptSecret (not decrypt) from @/lib/crypto.
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

const createOAuthClientMock = vi.fn();
vi.mock("@/lib/google", () => ({
  createOAuthClient: (...args: unknown[]) => createOAuthClientMock(...args),
}));

const decryptSecretMock = vi.fn((v: string) => `dec(${v})`);
vi.mock("@/lib/crypto", () => ({
  decryptSecret: (...args: [string]) => decryptSecretMock(...args),
}));

describe("POST /api/connectors/gmail/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no valid session", async () => {
    requireUserMock.mockRejectedValue(new FakeUnauthorizedError("Not authenticated"));
    const { POST } = await import("../route");
    const res = await POST();

    expect(res.status).toBe(401);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("deletes the connection without attempting a revoke when none is stored", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockResolvedValueOnce({ rows: [] }); // SELECT finds nothing
    queryMock.mockResolvedValueOnce({ rows: [] }); // DELETE

    const { POST } = await import("../route");
    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createOAuthClientMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toMatch(/DELETE FROM gmail_connections/);
  });

  it("revokes the decrypted refresh token with Google, then deletes the row", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockResolvedValueOnce({
      rows: [{ refresh_token_enc: "encrypted-refresh" }],
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    const revokeToken = vi.fn().mockResolvedValue(undefined);
    createOAuthClientMock.mockReturnValue({ revokeToken });

    const { POST } = await import("../route");
    const res = await POST();

    expect(decryptSecretMock).toHaveBeenCalledWith("encrypted-refresh");
    expect(revokeToken).toHaveBeenCalledWith("dec(encrypted-refresh)");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("still deletes the row even when Google's revoke call fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    queryMock.mockResolvedValueOnce({
      rows: [{ refresh_token_enc: "encrypted-refresh" }],
    });
    queryMock.mockResolvedValueOnce({ rows: [] });

    createOAuthClientMock.mockReturnValue({
      revokeToken: vi.fn().mockRejectedValue(new Error("google is down")),
    });

    const { POST } = await import("../route");
    const res = await POST();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[1][0]).toMatch(/DELETE FROM gmail_connections/);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
