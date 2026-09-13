import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session-token";

const PROTECTED_PAGE_PREFIXES = ["/calling-agent"];
const PROTECTED_API_PREFIXES = ["/api/calling-agent"];
// Vapi's servers call the webhook directly (no browser session to send),
// and it authenticates itself via the x-vapi-secret header instead — see
// lib/calling-agent/webhook-auth.ts.
// The public /demo dashboard has no session to send either. That route
// never reads a number from its request — it dials DEMO_CALL_NUMBER and
// nothing else — which is what makes exempting it safe.
const EXEMPT_PATHS = ["/api/calling-agent/webhook", "/api/calling-agent/demo-call"];

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
    // the same parent domain) owns sign-in. PORTAL_LOGIN_URL points there;
    // see docs/CALLING_AGENT.md "Multi-tenancy" for the shared-session contract.
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
  matcher: ["/calling-agent/:path*", "/api/calling-agent/:path*"],
};
