import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Image from "next/image";
import pool from "@/lib/db";
import { verifySession, SESSION_COOKIE_NAME } from "@/lib/auth";

export default async function LoginExtendPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? verifySession(token) : null;

  if (!session) {
    redirect("/login");
  }

  const result = await pool.query(
    "SELECT name, email, created_at FROM users WHERE id = $1",
    [session.userId],
  );
  const user = result.rows[0];

  if (!user) {
    redirect("/login");
  }

  const profile = await pool.query(
    "SELECT 1 FROM user_profiles WHERE user_id = $1",
    [session.userId],
  );
  if (!profile.rowCount) {
    redirect("/onboarding");
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[420px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        <div className="mb-7 flex items-center gap-2">
          <Image src="/logo1.png" alt="" width={32} height={32} className="h-8 w-8 object-contain" priority />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Vouch
          </span>
        </div>

        <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">
          You&apos;re logged in
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          Signed in as <span className="font-semibold text-slate-700">{user.email}</span>
        </p>

        <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Name</span>
            <span className="font-medium text-slate-900">{user.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Email</span>
            <span className="font-medium text-slate-900">{user.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Joined</span>
            <span className="font-medium text-slate-900">
              {new Date(user.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
