"use client";

import { useEffect, useState } from "react";

type HealthResponse =
  | { ok: true; now: string; version: string }
  | { ok: false; error: string };

export default function Home() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch((error) => setHealth({ ok: false, error: String(error) }));
  }, []);

  return (
    <main style={{ maxWidth: 640, margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1>Vouch</h1>
      <p>Database connection status:</p>
      {!health && <p>Checking…</p>}
      {health?.ok && (
        <div>
          <p>✅ Connected</p>
          <p style={{ fontSize: 14, opacity: 0.7 }}>{health.version}</p>
          <p style={{ fontSize: 14, opacity: 0.7 }}>Server time: {health.now}</p>
        </div>
      )}
      {health && !health.ok && (
        <div>
          <p>❌ Not connected</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{health.error}</pre>
        </div>
      )}
    </main>
  );
}
