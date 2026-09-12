import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";
import OnboardingForm from "@/components/onboarding-form";

export default async function OnboardingPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;

  if (!session) {
    redirect("/login");
  }

  const existing = await pool.query(
    "SELECT 1 FROM user_profiles WHERE user_id = $1",
    [session.userId],
  );
  if (existing.rowCount && existing.rowCount > 0) {
    redirect("/login-extend");
  }

  return <OnboardingForm />;
}
