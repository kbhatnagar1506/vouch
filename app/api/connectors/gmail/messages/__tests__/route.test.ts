// Adapted from aaditisinghal/vouch-aaditi's
// src/app/api/connectors/gmail/messages/__tests__/route.test.ts (commit
// 55eedf7). This route uses @/lib/session's requireUser()/UnauthorizedError
// (not a manual verifySession()+cookie check).
import { describe, expect, it, beforeEach, vi } from "vitest";

const requireUserMock = vi.fn();
class FakeUnauthorizedError extends Error {}
vi.mock("@/lib/session", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
  UnauthorizedError: FakeUnauthorizedError,
}));

const getGmailClientForUserMock = vi.fn();
vi.mock("@/lib/google", () => ({
  getGmailClientForUser: (...args: unknown[]) => getGmailClientForUserMock(...args),
}));

describe("GET /api/connectors/gmail/messages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when there is no valid session", async () => {
    requireUserMock.mockRejectedValue(new FakeUnauthorizedError("Not authenticated"));
    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(401);
    expect(getGmailClientForUserMock).not.toHaveBeenCalled();
  });

  it("returns 409 when the user hasn't connected Gmail", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    getGmailClientForUserMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const res = await GET();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Gmail not connected" });
  });

  it("fetches up to 5 messages and shapes the response from headers", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });

    const list = vi.fn().mockResolvedValue({
      data: { messages: [{ id: "m1" }, { id: "m2" }] },
    });
    const get = vi.fn(({ id }: { id: string }) =>
      Promise.resolve({
        data: {
          snippet: `snippet-${id}`,
          payload: {
            headers: [
              { name: "Subject", value: `Subject ${id}` },
              { name: "From", value: `from-${id}@example.com` },
              { name: "Date", value: "Mon, 1 Jan 2026 00:00:00 GMT" },
            ],
          },
        },
      }),
    );

    getGmailClientForUserMock.mockResolvedValue({
      email: "user@gmail.com",
      gmail: { users: { messages: { list, get } } },
    });

    const { GET } = await import("../route");
    const res = await GET();

    expect(list).toHaveBeenCalledWith({ userId: "me", maxResults: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      email: "user@gmail.com",
      messages: [
        {
          id: "m1",
          subject: "Subject m1",
          from: "from-m1@example.com",
          date: "Mon, 1 Jan 2026 00:00:00 GMT",
          snippet: "snippet-m1",
        },
        {
          id: "m2",
          subject: "Subject m2",
          from: "from-m2@example.com",
          date: "Mon, 1 Jan 2026 00:00:00 GMT",
          snippet: "snippet-m2",
        },
      ],
    });
  });

  it("defaults missing header values to empty strings and handles no messages", async () => {
    requireUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });

    getGmailClientForUserMock.mockResolvedValue({
      email: "user@gmail.com",
      gmail: {
        users: {
          messages: {
            list: vi.fn().mockResolvedValue({ data: {} }),
            get: vi.fn(),
          },
        },
      },
    });

    const { GET } = await import("../route");
    const res = await GET();

    expect(await res.json()).toEqual({ email: "user@gmail.com", messages: [] });
  });
});
