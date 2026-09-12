// Shared by /bank and /bank/oauth-return — calling exchange-token is
// identical whether Link finished in the same tab or came back via an
// OAuth institution redirect.
export async function exchangePublicToken(publicToken: string): Promise<{ added: number }> {
  const res = await fetch("/api/plaid/exchange-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_token: publicToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to connect account");
  return { added: data.initial_sync.added };
}

export const LINK_TOKEN_STORAGE_KEY = "plaid_link_token";
