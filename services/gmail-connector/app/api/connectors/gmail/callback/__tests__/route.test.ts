// Adapted from aaditisinghal/vouch-aaditi's
// src/app/api/connectors/gmail/callback/__tests__/route.test.ts (commit
// 55eedf7). This route's actual structure differs from hers in a few ways
// this test follows rather than her original: session comes from
// @/lib/session's getCurrentUser() (not a manual verifySession()+cookie
// check), the unauthenticated redirect goes to PORTAL_LOGIN_URL (a full
// URL, not a relative /login), and the failure redirect target is /connect
// (not /login-extend) since that's this branch's own connector page.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const getCurrentUserMock = vi.fn();
vi.mock("@/lib/session", () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
}));

const createOAuthClientMock = vi.fn();
vi.mock("@/lib/google", () => ({
  createOAuthClient: (...args: unknown[]) => createOAuthClientMock(...args),
  GMAIL_OAUTH_STATE_COOKIE: "gmail_oauth_state",
}));

const encryptSecretMock = vi.fn((v: string) => `enc(${v})`);
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (...args: [string]) => encryptSecretMock(...args),
}));

const queryMock = vi.fn();
vi.mock("@/lib/db", () => ({
  pool: { query: (...args: unknown[]) => queryMock(...args) },
}));

const oauth2UserinfoGetMock = vi.fn();
vi.mock("googleapis", () => ({
  google: {
    oauth2: () => ({ userinfo: { get: (...a: unknown[]) => oauth2UserinfoGetMock(...a) } }),
  },
}));

const syncGmailForUserMock = vi.fn();
vi.mock("@/lib/gmail-sync", () => ({
  syncGmailForUser: (...args: unknown[]) => syncGmailForUserMock(...args),
}));

vi.mock("@/lib/gmail-query", () => ({
  monthsAgoUnixSeconds: () => 1111111111,
}));

let stateCookieValue: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      if (name === "gmail_oauth_state" && stateCookieValue) {
        return { value: stateCookieValue };
      }
      return undefined;
    },
  }),
}));

function callbackUrl(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/connectors/gmail/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

describe("GET /api/connectors/gmail/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stateCookieValue = "expected-state";
    getCurrentUserMock.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    syncGmailForUserMock.mockResolvedValue({
      userId: "user-1",
      connected: true,
      fetched: 0,
      imported: 0,
      skippedEmptyBody: 0,
      classified: 0,
      errors: [],
    });
  });

  it("redirects to PORTAL_LOGIN_URL when there is no valid session", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://login.getvouch.club/login");
  });

  it("redirects with gmail_error=<error> when Google reports an error param", async () => {
    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ error: "access_denied" }));
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/connect");
    expect(location.searchParams.get("gmail_error")).toBe("access_denied");
  });

  it("fails with invalid_state when the code is missing", async () => {
    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ state: "expected-state" }));
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("gmail_error")).toBe("invalid_state");
  });

  it("fails with invalid_state when the state does not match the cookie", async () => {
    const { GET } = await import("../route");
    const req = new NextRequest(
      callbackUrl({ code: "abc", state: "wrong-state" }),
    );
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("gmail_error")).toBe("invalid_state");
  });

  it("fails with invalid_state when there is no state cookie at all", async () => {
    stateCookieValue = undefined;
    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("gmail_error")).toBe("invalid_state");
  });

  it("fails with missing_tokens when Google doesn't return a full token set", async () => {
    createOAuthClientMock.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({ tokens: { access_token: "at" } }),
      setCredentials: vi.fn(),
    });

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("gmail_error")).toBe("missing_tokens");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("fails with missing_email when Google's profile has no email", async () => {
    createOAuthClientMock.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({
        tokens: {
          access_token: "at",
          refresh_token: "rt",
          expiry_date: 123,
          scope: "s",
        },
      }),
      setCredentials: vi.fn(),
    });
    oauth2UserinfoGetMock.mockResolvedValue({ data: {} });

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("gmail_error")).toBe("missing_email");
  });

  it("stores encrypted tokens and redirects to BANK_CONNECTION_URL on success", async () => {
    const setCredentials = vi.fn();
    createOAuthClientMock.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({
        tokens: {
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          expiry_date: 1700000000000,
          scope: "gmail.readonly",
        },
      }),
      setCredentials,
    });
    oauth2UserinfoGetMock.mockResolvedValue({ data: { email: "user@gmail.com" } });
    queryMock.mockResolvedValue({ rows: [] });

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    expect(setCredentials).toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO gmail_connections/);
    expect(params).toEqual([
      "user-1",
      "user@gmail.com",
      "enc(access-token-value)",
      "enc(refresh-token-value)",
      "gmail.readonly",
      1700000000000,
    ]);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://bankconnection.getvouch.club/bank");
    // the one-time state cookie must be cleared
    expect(res.cookies.get("gmail_oauth_state")?.value).toBe("");
  });

  it("triggers an initial Gmail sync covering the last month after a successful connect", async () => {
    createOAuthClientMock.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({
        tokens: {
          access_token: "at",
          refresh_token: "rt",
          expiry_date: 1700000000000,
          scope: "gmail.readonly",
        },
      }),
      setCredentials: vi.fn(),
    });
    oauth2UserinfoGetMock.mockResolvedValue({ data: { email: "user@gmail.com" } });
    queryMock.mockResolvedValue({ rows: [] });

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    await GET(req);

    expect(syncGmailForUserMock).toHaveBeenCalledWith("user-1", {
      sinceUnixSeconds: 1111111111,
      maxMessages: 300,
    });
  });

  it("still redirects to BANK_CONNECTION_URL when the initial sync fails (non-fatal)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createOAuthClientMock.mockReturnValue({
      getToken: vi.fn().mockResolvedValue({
        tokens: {
          access_token: "at",
          refresh_token: "rt",
          expiry_date: 1700000000000,
          scope: "gmail.readonly",
        },
      }),
      setCredentials: vi.fn(),
    });
    oauth2UserinfoGetMock.mockResolvedValue({ data: { email: "user@gmail.com" } });
    queryMock.mockResolvedValue({ rows: [] });
    syncGmailForUserMock.mockRejectedValue(new Error("Vertex AI is down"));

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://bankconnection.getvouch.club/bank");
    expect(consoleSpy).toHaveBeenCalledWith(
      "Initial Gmail sync failed (non-fatal):",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it("fails with exchange_failed and logs when the token exchange throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    createOAuthClientMock.mockReturnValue({
      getToken: vi.fn().mockRejectedValue(new Error("network down")),
      setCredentials: vi.fn(),
    });

    const { GET } = await import("../route");
    const req = new NextRequest(callbackUrl({ code: "abc", state: "expected-state" }));
    const res = await GET(req);

    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("gmail_error")).toBe("exchange_failed");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
