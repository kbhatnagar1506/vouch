import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

const PROTECTED_PAGE_PREFIXES = ["/connect"];
const PROTECTED_API_PREFIXES = [
  "/api/connectors/gmail/status",
  "/api/connectors/gmail/disconnect",
  "/api/connectors/gmail/messages",
];
// connect/callback are the OAuth handshake itself — they check auth and
// redirect on their own (a JSON 401 would break the browser redirect
// flow), so middleware doesn't gate them.
const EXEMPT_PATHS = ["/api/connectors/gmail/connect", "/api/connectors/gmail/callback"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (EXEMPT_PATHS.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  const isProtectedPage = PROTECTED_PAGE_PREFIXES.some((p) => pathname.startsWith(p));
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtectedPage && !isProtectedApi) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (isProtectedApi) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    // No login UI lives on this branch — the portal (a sibling service on
    // the same parent domain) owns sign-in.
    const loginUrl = new URL(process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login");
    loginUrl.searchParams.set("next", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Downstream route handlers read the user via getCurrentUser()
  // (lib/session.ts), which re-verifies the cookie itself — this header
  // is only a fast-path hint, not trusted on its own.
  const response = NextResponse.next();
  response.headers.set("x-user-id", session.userId);
  return response;
}

export const config = {
  matcher: ["/connect/:path*", "/api/connectors/gmail/:path*"],
};
