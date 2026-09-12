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
    <main style={{ maxWidth: 720, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1>Completing bank connection…</h1>
      {error && (
        <p style={{ color: "crimson" }}>
          {error} <a href="/bank">Back to /bank</a>
        </p>
      )}
    </main>
  );
}
