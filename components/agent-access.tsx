"use client";

import { useCallback, useEffect, useState } from "react";

// Lets a user mint and revoke the bearer keys the MCP server authenticates
// with (app/api/mcp/route.ts). Before this, the only way to get one was to
// POST /api/mcp/keys by hand with a session cookie — fine for a smoke test,
// useless for actually connecting an agent.
//
// The raw token comes back exactly once, at creation (only its hash is
// stored — see lib/mcp/api-keys.ts), so it's held in component state and
// shown until dismissed rather than being re-fetchable.

const MCP_URL =
  process.env.NEXT_PUBLIC_MCP_URL ?? "https://cards.getvouch.club/api/mcp";

interface KeySummary {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function shortDate(value: string | null): string {
  if (!value) return "never";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AgentAccess() {
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "command" | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/keys");
      if (!res.ok) return;
      const data = await res.json();
      setKeys(data.keys ?? []);
    } catch {
      // Listing is decorative; a failure here shouldn't break the page.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "Claude" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not create a key");
      setFreshToken(data.token);
      setLabel("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch(`/api/mcp/keys/${id}/revoke`, { method: "POST" }).catch(() => {});
    await load();
  };

  const copy = async (text: string, what: "token" | "command") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("Couldn't copy — select the text and copy it manually.");
    }
  };

  const command = freshToken
    ? `claude mcp add --transport http vouch-cards ${MCP_URL} --header "Authorization: Bearer ${freshToken}"`
    : "";

  const active = keys.filter((k) => !k.revokedAt);

  return (
    <div className="mt-8">
      <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Agent access</h2>
      <p className="mb-4 text-[13px] leading-relaxed text-slate-500">
        Give Claude (or any MCP client) a key and it can issue, freeze and cancel these cards for you. Agents never see a
        card number.
      </p>

      {freshToken && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 text-[13px] font-semibold text-amber-900">
            Copy this now — it&apos;s shown once and can&apos;t be retrieved again.
          </p>
          <code className="block break-all rounded-lg bg-white/70 p-2.5 font-mono text-[12px] text-slate-800">
            {freshToken}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => copy(freshToken, "token")}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-slate-800"
            >
              {copied === "token" ? "Copied" : "Copy key"}
            </button>
            <button
              onClick={() => copy(command, "command")}
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-blue-700"
            >
              {copied === "command" ? "Copied" : "Copy install command"}
            </button>
            <button
              onClick={() => setFreshToken(null)}
              className="rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-slate-500 hover:text-slate-700"
            >
              Done
            </button>
          </div>
          <p className="mt-3 text-[12px] text-amber-900/80">Then run the install command in your terminal.</p>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Key name (e.g. Claude)"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-blue-400"
        />
        <button
          onClick={create}
          disabled={busy}
          className="shrink-0 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Creating…" : "Create key"}
        </button>
      </div>

      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}

      {active.length > 0 && (
        <ul className="mt-3 space-y-2">
          {active.map((k) => (
            <li key={k.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-800">{k.label}</div>
                <div className="text-[12px] text-slate-500">
                  created {shortDate(k.createdAt)} · last used {shortDate(k.lastUsedAt)}
                </div>
              </div>
              <button
                onClick={() => revoke(k.id)}
                className="shrink-0 text-[12.5px] font-semibold text-slate-400 transition hover:text-red-600"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
