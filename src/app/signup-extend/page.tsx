import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function SignupExtendPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;

  if (!session) {
    redirect("/login");
  }

  const result = await pool.query("SELECT name, email FROM users WHERE id = $1", [
    session.userId,
  ]);
  const user = result.rows[0];

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[400px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        <div className="mb-7 flex items-center gap-2">
          <Image src="/logo1.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" priority />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Vouch
          </span>
        </div>

        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>

        <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">
          Account created
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Welcome, {user.name}. Your account for{" "}
          <span className="font-semibold text-slate-700">{user.email}</span> is
          ready. Let&apos;s set up your profile next.
        </p>

        <Link
          href="/onboarding"
          className="block w-full rounded-[10px] bg-blue-600 py-3 text-center text-[15px] font-bold text-white transition hover:brightness-110"
        >
          Continue
        </Link>
      </div>
    </div>
  );
}
