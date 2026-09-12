import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

// Where a logged-in, onboarded user goes next — the bank-connection
// service (a sibling branch/subdomain sharing this session cookie).
const BANK_CONNECTION_URL = process.env.BANK_CONNECTION_URL ?? "https://bankconnection.getvouch.club/bank";

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

  const profile = await pool.query("SELECT 1 FROM user_profiles WHERE user_id = $1", [session.userId]);
  if (!profile.rowCount) {
    redirect("/onboarding");
  }

  redirect(BANK_CONNECTION_URL);
}
