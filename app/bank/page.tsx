"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import Link from "next/link";
import { exchangePublicToken, LINK_TOKEN_STORAGE_KEY } from "@/lib/plaid-client-exchange";

// Next step in the onboarding chain once a bank account is connected.
const VOICE_REGISTER_URL = process.env.NEXT_PUBLIC_VOICE_REGISTER_URL ?? "https://voice.getvouch.club/voice/register";

interface Account {
  account_id: string;
  name: string;
  mask: string | null;
  type: string | null;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string | null;
  institution_name: string | null;
  item_status: string;
  transaction_count: string;
}

export default function BankPage() {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/plaid/accounts");
    const data = await res.json();
    if (res.ok) setAccounts(data.accounts);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => setEmail(data.user?.email ?? null));
    fetch("/api/plaid/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        setLinkToken(data.link_token);
        // Needed so /bank/oauth-return can resume this same Link session
        // after an OAuth institution redirects the user away and back.
        window.localStorage.setItem(LINK_TOKEN_STORAGE_KEY, data.link_token);
      })
      .catch((err) => setError(String(err)));
    loadAccounts();
  }, [loadAccounts]);

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // No login page on this branch — the portal owns sign-in.
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login";
  };

  const onSuccess: PlaidLinkOnSuccess = useCallback(
    async (publicToken) => {
      if (!publicToken) return;
      setStatus("Connecting…");
      setError(null);
      try {
        const { added } = await exchangePublicToken(publicToken);
        setStatus(`Connected. Synced ${added} transactions.`);
        await loadAccounts();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStatus("");
      }
    },
    [loadAccounts],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    onSuccess,
  });

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[640px] rounded-[20px] border border-slate-100 bg-white p-9 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        {email && (
          <div className="mb-3 flex justify-end gap-3 text-[13px] text-slate-500">
            <span>{email}</span>
            <button onClick={onLogout} className="font-semibold text-blue-600 hover:brightness-110">
              Log out
            </button>
          </div>
        )}

        <div className="mb-7 flex justify-center">
          <Image src="/logo1.png" alt="Vouch" width={1580} height={482} className="h-14 w-auto object-contain" priority />
        </div>

        <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">Bank connections</h1>
        <p className="mb-6 text-sm text-slate-500">
          Link a bank account to get started.
        </p>

        <button
          onClick={() => open()}
          disabled={!ready}
          className="mb-2 w-full rounded-[10px] bg-blue-600 py-3 text-[15px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Connect a bank account
        </button>
        {status && <p className="mt-2 text-sm text-slate-600">{status}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <h2 className="mt-8 mb-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
          Connected accounts
        </h2>
        {accounts.length === 0 && (
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No accounts connected yet.</p>
        )}
        {accounts.length > 0 && (
          <>
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={account.account_id}
                  className="flex items-center justify-between rounded-xl bg-slate-50 p-4 text-sm"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{account.institution_name}</div>
                    <div className="text-slate-500">
                      {account.name} ····{account.mask}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-slate-900">
                      {account.current_balance != null
                        ? `${account.current_balance} ${account.iso_currency_code ?? ""}`
                        : "—"}
                    </div>
                    <div className="text-slate-500">{account.transaction_count} transactions</div>
                  </div>
                </div>
              ))}
            </div>

            <Link
              href={VOICE_REGISTER_URL}
              className="mt-6 block w-full rounded-[10px] bg-blue-600 py-3 text-center text-[15px] font-bold text-white transition hover:brightness-110"
            >
              Continue
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
