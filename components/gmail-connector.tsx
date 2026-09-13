"use client";

import { useEffect, useState } from "react";
import { GmailIcon } from "@/components/gmail-icon";

type Status = { connected: boolean; email: string | null };
type Message = { id: string; subject: string; from: string; date: string; snippet?: string };

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "You declined Gmail access.",
  invalid_state: "That connection attempt expired — please try again.",
  missing_tokens: "Google didn't return the expected tokens — please try again.",
  missing_email: "Couldn't read your Google account email — please try again.",
  exchange_failed: "Something went wrong connecting to Google — please try again.",
};

export default function GmailConnector({ initialError }: { initialError?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? (ERROR_MESSAGES[initialError] ?? "Something went wrong.") : null,
  );

  useEffect(() => {
    fetch("/api/connectors/gmail/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ connected: false, email: null }));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/connectors/gmail/disconnect", { method: "POST" });
      setStatus({ connected: false, email: null });
      setMessages(null);
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleLoadMessages() {
    setLoadingMessages(true);
    setError(null);
    try {
      const res = await fetch("/api/connectors/gmail/messages");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't load messages");
        return;
      }
      setMessages(data.messages);
    } finally {
      setLoadingMessages(false);
    }
  }

  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <GmailIcon size={20} />
          Gmail
        </span>
        {status?.connected && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-600">Connected</span>
        )}
      </div>

      {error && <p className="mb-2 mt-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] font-medium text-red-600">{error}</p>}

      {status === null && <p className="mt-2 text-[13px] text-slate-400">Checking connection…</p>}

      {status && !status.connected && (
        <>
          <p className="mb-3 mt-2 text-[13px] text-slate-500">Connect your Gmail to allow read-only access to your inbox.</p>
          <a
            href="/api/connectors/gmail/connect"
            className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-blue-600 py-2.5 text-center text-sm font-bold text-white transition hover:brightness-110"
          >
            <GmailIcon size={16} />
            Connect Gmail
          </a>
        </>
      )}

      {status && status.connected && (
        <>
          <p className="mb-3 mt-2 text-[13px] text-slate-500">
            Connected as <span className="font-semibold text-slate-700">{status.email}</span>
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleLoadMessages}
              disabled={loadingMessages}
              className="flex-1 rounded-[10px] border-[1.5px] border-blue-600 py-2 text-[13px] font-bold text-blue-600 transition hover:bg-blue-50 disabled:opacity-60"
            >
              {loadingMessages ? "Loading…" : "View recent emails"}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="rounded-[10px] border-[1.5px] border-slate-200 px-3 py-2 text-[13px] font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-60"
            >
              {disconnecting ? "…" : "Disconnect"}
            </button>
          </div>

          {messages && (
            <ul className="mt-3 space-y-2">
              {messages.length === 0 && <li className="text-[13px] text-slate-400">No messages found.</li>}
              {messages.map((m) => (
                <li key={m.id} className="rounded-lg bg-white p-2.5 text-[12px]">
                  <p className="truncate font-semibold text-slate-800">{m.subject || "(no subject)"}</p>
                  <p className="truncate text-slate-500">{m.from}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
