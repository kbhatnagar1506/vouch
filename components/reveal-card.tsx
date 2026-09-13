"use client";

import { useEffect, useRef, useState } from "react";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";

// NOTE: this is the standard documented pattern for Stripe.js Issuing
// Elements (ephemeralKeySecret passed straight to elements.create), which
// is what's implemented here. Stripe has, on some accounts, layered an
// additional client-side nonce requirement on top of this
// (stripe.createEphemeralKeyNonce -> pass nonce when creating both the
// ephemeral key and the Element) for extra replay protection. This has
// not been exercised against a real test-mode card yet -- verify the
// reveal actually renders a number before relying on it, and add the
// nonce step here if Stripe's error message asks for one.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

export function RevealCard({ cardId, onClose }: { cardId: string; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const numberRef = useRef<HTMLDivElement>(null);
  const cvcRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let elements: StripeElements | null = null;
    let cancelled = false;

    (async () => {
      try {
        const stripe = await getStripe();
        if (!stripe) throw new Error("Stripe failed to load (missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?)");

        const res = await fetch(`/api/cards/${cardId}/reveal`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Couldn't prepare card reveal");
        if (cancelled) return;

        elements = stripe.elements();
        const style = { base: { fontSize: "16px", fontFamily: "monospace" } };

        const numberEl = elements.create("issuingCardNumberDisplay", {
          issuingCard: data.stripeCardId,
          ephemeralKeySecret: data.ephemeralKeySecret,
          style,
        });
        const cvcEl = elements.create("issuingCardCvcDisplay", {
          issuingCard: data.stripeCardId,
          ephemeralKeySecret: data.ephemeralKeySecret,
          style,
        });
        const expiryEl = elements.create("issuingCardExpiryDisplay", {
          issuingCard: data.stripeCardId,
          ephemeralKeySecret: data.ephemeralKeySecret,
          style,
        });

        if (numberRef.current) numberEl.mount(numberRef.current);
        if (cvcRef.current) cvcEl.mount(cvcRef.current);
        if (expiryRef.current) expiryEl.mount(expiryRef.current);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cardId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-[360px] rounded-[16px] bg-white p-6 shadow-xl">
        <h3 className="mb-4 text-[15px] font-bold text-slate-900">Card details</h3>
        {loading && <p className="text-sm text-slate-400">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className={loading || error ? "hidden" : "space-y-3"}>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Card number</div>
            <div ref={numberRef} className="h-9 rounded-lg bg-slate-50 px-3 py-2" />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">Expiry</div>
              <div ref={expiryRef} className="h-9 rounded-lg bg-slate-50 px-3 py-2" />
            </div>
            <div className="flex-1">
              <div className="mb-1 text-[11px] font-semibold uppercase text-slate-400">CVC</div>
              <div ref={cvcRef} className="h-9 rounded-lg bg-slate-50 px-3 py-2" />
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-[10px] border-[1.5px] border-slate-200 py-2 text-[13px] font-bold text-slate-500 transition hover:bg-slate-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}
