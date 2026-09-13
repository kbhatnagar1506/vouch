// Adapted from aaditisinghal/vouch-aaditi's
// src/app/api/cron/gmail-sync/__tests__/route.test.ts (commit 55eedf7) —
// only the @/lib/db mock shape changed (named `pool` export here, not
// `default`).
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const syncGmailForUserMock = vi.fn();
vi.mock("@/lib/gmail-sync", () => ({
  syncGmailForUser: (...args: unknown[]) => syncGmailForUserMock(...args),
}));

vi.mock("@/lib/gmail-query", () => ({
  monthsAgoUnixSeconds: () => 1111111111,
}));

function request(authHeader?: string) {
  return new NextRequest("http://localhost/api/cron/gmail-sync", {
    method: "POST",
    headers: authHeader ? { authorization: authHeader } : undefined,
  });
}

const ORIGINAL_ENV = { ...process.env };

describe("POST /api/cron/gmail-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, CRON_SECRET: "test-secret" };
  });

  it("returns 401 when no Authorization header is present", async () => {
    const { POST } = await import("../route");
    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(syncGmailForUserMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the bearer token is wrong", async () => {
    const { POST } = await import("../route");
    const res = await POST(request("Bearer wrong-secret"));

    expect(res.status).toBe(401);
    expect(syncGmailForUserMock).not.toHaveBeenCalled();
  });

  it("returns 401 (fail closed) when CRON_SECRET is unset, even with a header", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await import("../route");
    const res = await POST(request("Bearer anything"));

    expect(res.status).toBe(401);
    expect(syncGmailForUserMock).not.toHaveBeenCalled();
  });

  it("syncs every connected user with the right per-user since window", async () => {
    queryMock.mockResolvedValue({
      rows: [
        { user_id: "user-1", last_synced_at: "2026-01-01T00:00:00.000Z" },
        { user_id: "user-2", last_synced_at: null },
      ],
    });
    syncGmailForUserMock.mockResolvedValue({
      userId: "x",
      connected: true,
      fetched: 1,
      imported: 1,
      skippedEmptyBody: 0,
      classified: 1,
      errors: [],
    });

    const { POST } = await import("../route");
    const res = await POST(request("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedUsers).toBe(2);
    expect(syncGmailForUserMock).toHaveBeenCalledTimes(2);
    expect(syncGmailForUserMock).toHaveBeenNthCalledWith(1, "user-1", {
      sinceUnixSeconds: Math.floor(new Date("2026-01-01T00:00:00.000Z").getTime() / 1000),
      maxMessages: 300,
    });
    expect(syncGmailForUserMock).toHaveBeenNthCalledWith(2, "user-2", {
      sinceUnixSeconds: 1111111111,
      maxMessages: 300,
    });
  });

  it("isolates a per-user failure: other users still process and the response is still 200", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    queryMock.mockResolvedValue({
      rows: [
        { user_id: "user-1", last_synced_at: null },
        { user_id: "user-2", last_synced_at: null },
      ],
    });
    syncGmailForUserMock
      .mockRejectedValueOnce(new Error("Vertex AI quota exceeded"))
      .mockResolvedValueOnce({
        userId: "user-2",
        connected: true,
        fetched: 0,
        imported: 0,
        skippedEmptyBody: 0,
        classified: 0,
        errors: [],
      });

    const { POST } = await import("../route");
    const res = await POST(request("Bearer test-secret"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedUsers).toBe(2);
    expect(body.results[0]).toEqual({
      userId: "user-1",
      error: "Vertex AI quota exceeded",
    });
    expect(body.results[1].userId).toBe("user-2");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
