// Adapted from aaditisinghal/vouch-aaditi's feature/gmail-connector branch
// (commit 2c943b6, before it was removed there) — same OAuth logic, wired
// to this repo's actual lib/db.ts (named export) and lib/crypto.ts.
import { google } from "googleapis";
import { pool } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export const GMAIL_OAUTH_STATE_COOKIE = "gmail_oauth_state";

export const GMAIL_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export function getRedirectUri(): string {
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/connectors/gmail/callback`;
}

export function createOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables must be set");
  }

  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

export async function getGmailClientForUser(userId: string) {
  const result = await pool.query(
    `SELECT google_email, access_token_enc, refresh_token_enc, expiry_date
       FROM gmail_connections WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({
    access_token: decryptSecret(row.access_token_enc),
    refresh_token: decryptSecret(row.refresh_token_enc),
    expiry_date: Number(row.expiry_date),
  });

  const previousAccessToken = oauthClient.credentials.access_token;
  await oauthClient.getAccessToken(); // refreshes in-place if expired

  if (oauthClient.credentials.access_token !== previousAccessToken) {
    await pool.query(
      `UPDATE gmail_connections
         SET access_token_enc = $1, expiry_date = $2
       WHERE user_id = $3`,
      [encryptSecret(oauthClient.credentials.access_token as string), oauthClient.credentials.expiry_date, userId],
    );
  }

  return {
    gmail: google.gmail({ version: "v1", auth: oauthClient }),
    email: row.google_email as string,
  };
}
