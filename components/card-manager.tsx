"use client";

import { useEffect, useState } from "react";
import { RevealCard } from "@/components/reveal-card";

interface Card {
  id: string;
  label: string;
  merchant: string | null;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  status: "active" | "inactive" | "canceled";
  spendingLimitCents: number | null;
  singleUse: boolean;
  createdAt: string;
}

const STATUS_STYLES: Record<Card["status"], string> = {
  active: "bg-emerald-50 text-emerald-600",
  inactive: "bg-amber-50 text-amber-600",
  canceled: "bg-slate-100 text-slate-400",
};

export function CardManager() {
  const [cards, setCards] = useState<Card[] | null>(null);
  const [label, setLabel] = useState("");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [needsPhone, setNeedsPhone] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealingCardId, setRevealingCardId] = useState<string | null>(null);
  const [busyCardId, setBusyCardId] = useState<string | null>(null);

  const loadCards = async () => {
    const res = await fetch("/api/cards");
    const data = await res.json();
    if (res.ok) setCards(data.cards);
  };

  useEffect(() => {
    loadCards();
  }, []);

  const onGenerate = async () => {
    if (!label.trim()) {
      setError("Give the card a label (e.g. the merchant name).");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const amountCents = amount.trim() ? Math.round(Number.parseFloat(amount) * 100) : undefined;
      if (amount.trim() && (!Number.isFinite(amountCents) || amountCents! <= 0)) {
        throw new Error("Amount must be a positive number.");
      }
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          merchant: merchant.trim() || undefined,
          spendingLimitCents: amountCents,
          phoneNumber: phoneNumber.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.phoneRequired) setNeedsPhone(true);
        throw new Error(data.error ?? "Couldn't generate a card");
      }
      setLabel("");
      setMerchant("");
      setAmount("");
      setNeedsPhone(false);
      await loadCards();
      setRevealingCardId(data.card.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const onCancel = async (cardId: string) => {
    setBusyCardId(cardId);
    try {
      await fetch(`/api/cards/${cardId}/cancel`, { method: "POST" });
      await loadCards();
    } finally {
      setBusyCardId(null);
    }
  };

  return (
    <div>
      <h1 className="mb-1.5 text-2xl font-bold tracking-tight text-slate-900">Temporary cards</h1>
      <p className="mb-6 text-sm text-slate-500">
        Every card is single-use: the moment its one transaction posts, it&apos;s automatically canceled — a
        subscription tied to it can never be charged again.
      </p>

      <div className="mb-8 rounded-xl bg-slate-50 p-4">
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Netflix)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="Merchant (optional)"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Max amount in USD (optional)"
          inputMode="decimal"
          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        {needsPhone && (
          <div className="mb-3">
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="Phone number, e.g. +14155550123"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <p className="mt-1 text-[12px] text-slate-400">
              One-time — Stripe needs this to verify you as a cardholder. By continuing, you agree to Stripe&apos;s
              cardholder terms.
            </p>
          </div>
        )}
        <button
          onClick={onGenerate}
          disabled={creating}
          className="w-full rounded-[10px] bg-blue-600 py-2.5 text-[14px] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {creating ? "Generating…" : "Generate a card"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Your cards</h2>
      {cards === null && <p className="text-sm text-slate-400">Loading…</p>}
      {cards !== null && cards.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No cards generated yet.</p>
      )}
      {cards !== null && cards.length > 0 && (
        <div className="space-y-2">
          {cards.map((card) => (
            <div key={card.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-4 text-sm">
              <div>
                <div className="flex items-center gap-2 font-semibold text-slate-900">
                  {card.label}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[card.status]}`}>
                    {card.status}
                  </span>
                </div>
                <div className="text-slate-500">
                  {card.brand} ····{card.last4} · exp {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                  {card.merchant ? ` · ${card.merchant}` : ""}
                </div>
              </div>
              <div className="flex gap-2">
                {card.status === "active" && (
                  <>
                    <button
                      onClick={() => setRevealingCardId(card.id)}
                      className="rounded-lg border-[1.5px] border-blue-600 px-3 py-1.5 text-[12px] font-bold text-blue-600 transition hover:bg-blue-50"
                    >
                      Reveal
                    </button>
                    <button
                      onClick={() => onCancel(card.id)}
                      disabled={busyCardId === card.id}
                      className="rounded-lg border-[1.5px] border-slate-200 px-3 py-1.5 text-[12px] font-bold text-slate-500 transition hover:bg-slate-100 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {revealingCardId && <RevealCard cardId={revealingCardId} onClose={() => setRevealingCardId(null)} />}
    </div>
  );
}
