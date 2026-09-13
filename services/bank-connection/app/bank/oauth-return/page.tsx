"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { exchangePublicToken, LINK_TOKEN_STORAGE_KEY } from "@/lib/plaid-client-exchange";

// Where Plaid sends the user back after an OAuth institution's login page
// (e.g. some banks require this instead of an embedded webview). Must
// exactly match a redirect URI registered in the Plaid dashboard AND the
// PLAID_REDIRECT_URI env var used by /api/plaid/create-link-token — see
// docs/PLAID.md.
export default function PlaidOAuthReturnPage() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(LINK_TOKEN_STORAGE_KEY);
    if (!stored) {
      setError("No pending Plaid Link session found. Go back to /bank and try connecting again.");
      return;
    }
    setLinkToken(stored);
  }, []);

  const onSuccess: PlaidLinkOnSuccess = async (publicToken) => {
    if (!publicToken) return;
    try {
      await exchangePublicToken(publicToken);
      window.localStorage.removeItem(LINK_TOKEN_STORAGE_KEY);
      router.replace("/bank");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const { open, ready } = usePlaidLink({
    token: linkToken ?? "",
    receivedRedirectUri: typeof window !== "undefined" ? window.location.href : undefined,
    onSuccess,
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-gradient-to-br from-blue-50 via-white to-blue-50 px-4 py-8">
      <div className="w-full max-w-[400px] rounded-[20px] border border-slate-100 bg-white p-9 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]">
        <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">Completing connection…</h1>
        {error && (
          <p className="mt-4 text-sm text-red-600">
            {error}{" "}
            <a href="/bank" className="font-semibold text-blue-600 hover:brightness-110">
              Back to /bank
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
