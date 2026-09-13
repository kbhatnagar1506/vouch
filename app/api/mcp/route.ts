import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getUserById } from "@/lib/auth";
import { verifyApiKey } from "@/lib/mcp/api-keys";
import { buildMcpServer } from "@/lib/mcp/server";

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
}

// Same client-IP extraction as app/api/cards/route.ts's getRequestIp, just
// against a plain Request (this route is driven by the MCP transport, which
// works on Web Standard Request/Response, not NextRequest).
function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "127.0.0.1";
}

// MCP clients (Claude, OpenAI-based agents, …) aren't browsers -- they
// can't carry the vouch_session cookie every other route here relies on --
// so this endpoint is deliberately outside middleware.ts's cookie-based
// protection and authenticates itself via a bearer token instead. Mint one
// with the cookie-authenticated POST /api/mcp/keys. See docs/CARDS.md
// "MCP server" for the full setup.
async function handle(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(authHeader)?.[1];
  if (!token) {
    return jsonError("Missing Authorization: Bearer <token> header. Mint one via POST /api/mcp/keys.", 401);
  }

  const verified = await verifyApiKey(token);
  if (!verified) {
    return jsonError("Invalid or revoked API key.", 401);
  }
  const user = await getUserById(verified.userId);
  if (!user) {
    return jsonError("The user this key belongs to no longer exists.", 401);
  }

  // A fresh server + stateless transport per request: nothing here needs
  // (or could rely on) surviving between invocations on Vercel's
  // serverless functions, and each request is scoped to exactly one user
  // via the closures inside buildMcpServer.
  const server = buildMcpServer(user, getRequestIp(request));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
