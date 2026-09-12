"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { exchangePublicToken, LINK_TOKEN_STORAGE_KEY } from "@/lib/plaid-client-exchange";

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
    window.location.href = process.env.NEXT_PUBLIC_PORTAL_LOGIN_URL ?? "https://getvouch.club/login";
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
    <main style={{ maxWidth: 720, margin: "4rem auto", padding: "0 1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Bank connections</h1>
        {email && (
          <p style={{ fontSize: 14 }}>
            {email} · <button onClick={onLogout}>Log out</button>
          </p>
        )}
      </div>
      <p>
        <button onClick={() => open()} disabled={!ready}>
          Connect a bank account
        </button>
      </p>
      {status && <p>{status}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h2>Connected accounts</h2>
      {accounts.length === 0 && <p>No accounts connected yet.</p>}
      {accounts.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Institution</th>
              <th style={{ textAlign: "left" }}>Account</th>
              <th style={{ textAlign: "right" }}>Balance</th>
              <th style={{ textAlign: "right" }}>Transactions</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => (
              <tr key={account.account_id}>
                <td>{account.institution_name}</td>
                <td>
                  {account.name} ····{account.mask}
                </td>
                <td style={{ textAlign: "right" }}>
                  {account.current_balance != null
                    ? `${account.current_balance} ${account.iso_currency_code ?? ""}`
                    : "—"}
                </td>
                <td style={{ textAlign: "right" }}>{account.transaction_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
