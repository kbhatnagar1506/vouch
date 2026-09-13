import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

// Where a logged-in user goes next — first step of the onboarding chain
// (Gmail -> bank -> voice registration), each a sibling branch/subdomain
// sharing this session cookie.
const GMAIL_CONNECTOR_URL = process.env.GMAIL_CONNECTOR_URL ?? "https://gmail.getvouch.club/connect";

export default async function LoginExtendPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;

  if (!session) {
    redirect("/login");
  }

  const result = await pool.query("SELECT 1 FROM users WHERE id = $1", [session.userId]);
  if (!result.rowCount) {
    redirect("/login");
  }

  redirect(GMAIL_CONNECTOR_URL);
}
