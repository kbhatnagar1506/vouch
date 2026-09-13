// Adapted from aaditisinghal/vouch-aaditi's
// src/app/api/connectors/gmail/connect/__tests__/route.test.ts (commit
// 55eedf7). This route uses @/lib/session's getCurrentUser() (not a manual
// verifySession()+cookie check) and redirects to PORTAL_LOGIN_URL (a full
// URL, not a relative /login) when unauthenticated.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const getCurrentUserMock = vi.fn();
vi.mock("@/lib/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

const createOAuthClientMock = vi.fn();
vi.mock("@/lib/google", () => ({
  createOAuthClient: (...args: unknown[]) => createOAuthClientMock(...args),
  GMAIL_SCOPES: ["openid", "email", "profile", "gmail.readonly"],
  GMAIL_OAUTH_STATE_COOKIE: "gmail_oauth_state",
}));

describe("GET /api/connectors/gmail/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to PORTAL_LOGIN_URL when there is no valid session", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const req = new NextRequest("http://localhost/api/connectors/gmail/connect");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://login.getvouch.club/login");
    expect(createOAuthClientMock).not.toHaveBeenCalled();
  });

  it("redirects to the generated Google auth URL and sets a state cookie", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });

    const generateAuthUrl = vi
      .fn()
      .mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth?state=abc");
    createOAuthClientMock.mockReturnValue({ generateAuthUrl });

    const { GET } = await import("../route");
    const req = new NextRequest("http://localhost/api/connectors/gmail/connect");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
    );

    expect(generateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        access_type: "offline",
        prompt: "consent",
        scope: ["openid", "email", "profile", "gmail.readonly"],
        state: expect.any(String),
      }),
    );

    const stateCookie = res.cookies.get("gmail_oauth_state");
    expect(stateCookie?.value).toEqual(expect.any(String));
    expect(stateCookie?.value.length).toBeGreaterThan(0);
  });

  it("generates a fresh random state value on every call", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    createOAuthClientMock.mockReturnValue({
      generateAuthUrl: vi.fn().mockReturnValue("https://accounts.google.com/mock"),
    });

    const { GET } = await import("../route");
    const req = new NextRequest("http://localhost/api/connectors/gmail/connect");

    const res1 = await GET(req);
    const res2 = await GET(req);

    expect(res1.cookies.get("gmail_oauth_state")?.value).not.toBe(
      res2.cookies.get("gmail_oauth_state")?.value,
    );
  });
});
