import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import GmailConnector from "@/components/gmail-connector";

const BANK_CONNECTION_URL = process.env.BANK_CONNECTION_URL ?? "https://bankconnection.getvouch.club/bank";

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ gmail_error?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect(process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login");
  }

  const { gmail_error: gmailError } = await searchParams;

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[440px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        <div className="mb-3 flex justify-end text-[13px] text-slate-500">
          <span>{user.email}</span>
        </div>

        <div className="mb-7 flex justify-center">
          <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-14 w-auto object-contain" priority />
        </div>

        <h1 className="mb-1.5 text-center text-2xl font-bold tracking-tight text-slate-900">Connect your Gmail</h1>
        <p className="mb-6 text-center text-sm text-slate-500">Read-only access — helps us verify who you are.</p>

        <GmailConnector initialError={gmailError} />

        <Link
          href={BANK_CONNECTION_URL}
          className="mt-5 block text-center text-[13px] font-semibold text-slate-400 hover:text-slate-600"
        >
          Skip for now
        </Link>
      </div>
    </div>
  );
}
