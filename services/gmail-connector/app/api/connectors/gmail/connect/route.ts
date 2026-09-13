import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getCurrentUser } from "@/lib/session";
import { createOAuthClient, GMAIL_SCOPES, GMAIL_OAUTH_STATE_COOKIE } from "@/lib/google";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login");
  }

  const state = crypto.randomBytes(24).toString("hex");
  const oauthClient = createOAuthClient();

  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GMAIL_SCOPES,
    state,
  });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return response;
}
