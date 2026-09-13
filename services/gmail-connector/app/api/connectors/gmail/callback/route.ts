import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { google } from "googleapis";
import { pool } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { createOAuthClient, GMAIL_OAUTH_STATE_COOKIE } from "@/lib/google";
import { encryptSecret } from "@/lib/crypto";
import { syncGmailForUser } from "@/lib/gmail-sync";
import { monthsAgoUnixSeconds } from "@/lib/gmail-query";

// Next step in the onboarding chain once Gmail is connected.
const BANK_CONNECTION_URL = process.env.BANK_CONNECTION_URL ?? "https://bankconnection.getvouch.club/bank";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login");
  }

  const cookieStore = await cookies();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const expectedState = cookieStore.get(GMAIL_OAUTH_STATE_COOKIE)?.value;

  const failRedirect = (reason: string) => {
    const dest = new URL("/connect", req.url);
    dest.searchParams.set("gmail_error", reason);
    const response = NextResponse.redirect(dest);
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  };

  if (error) {
    return failRedirect(error);
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return failRedirect("invalid_state");
  }

  try {
    const oauthClient = createOAuthClient();
    const { tokens } = await oauthClient.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry_date) {
      return failRedirect("missing_tokens");
    }

    oauthClient.setCredentials(tokens);
    const oauth2 = google.oauth2({ auth: oauthClient, version: "v2" });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) {
      return failRedirect("missing_email");
    }

    await pool.query(
      `INSERT INTO gmail_connections
         (user_id, google_email, access_token_enc, refresh_token_enc, scope, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         google_email = EXCLUDED.google_email,
         access_token_enc = EXCLUDED.access_token_enc,
         refresh_token_enc = EXCLUDED.refresh_token_enc,
         scope = EXCLUDED.scope,
         expiry_date = EXCLUDED.expiry_date`,
      [user.id, profile.email, encryptSecret(tokens.access_token), encryptSecret(tokens.refresh_token), tokens.scope ?? "", tokens.expiry_date],
    );

    const response = NextResponse.redirect(BANK_CONNECTION_URL);
    response.cookies.set(GMAIL_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });

    try {
      await syncGmailForUser(user.id, {
        sinceUnixSeconds: monthsAgoUnixSeconds(1),
        maxMessages: 300,
      });
    } catch (syncErr) {
      console.error("Initial Gmail sync failed (non-fatal):", syncErr);
    }

    return response;
  } catch (err) {
    console.error("Gmail OAuth callback failed:", err);
    return failRedirect("exchange_failed");
  }
}
