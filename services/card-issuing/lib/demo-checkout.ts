// A merchant side for demos: a Stripe Checkout page a Vouch-issued card can
// actually be paid on, so the whole loop — mint a card, charge it, watch the
// card die — can be shown end to end without involving a third-party shop.
//
// Every session here is created with `capture_method: "manual"`, and there
// is deliberately NO capture function in this file. That is the safety
// property that makes this demo-safe: the card is authorized over the real
// network (which is what makes Vouch's issuing webhook fire for real), but
// the money is never taken, and voiding the authorization releases the hold
// immediately rather than starting a multi-day refund.
//
// Runs against DEMO_CHECKOUT_STRIPE_KEY — an account with charges enabled,
// which is NOT the same thing as the Issuing account STRIPE_SECRET_KEY
// points at. Unset, the tools are simply not registered.
import Stripe from "stripe";

const STRIPE_API_VERSION = "2024-12-18.acacia" satisfies Stripe.LatestApiVersion;

/**
 * Ceiling on what a single demo authorization may hold. An agent picks the
 * amount, so this bounds the worst case of it picking badly — a stuck hold
 * is a nuisance at $50 and a problem at $5,000.
 */
const MAX_AMOUNT_CENTS = 5_000;

let cached: Stripe | null = null;

export function isCheckoutConfigured(): boolean {
  return Boolean(process.env.DEMO_CHECKOUT_STRIPE_KEY);
}

function client(): Stripe {
  if (!cached) {
    const key = process.env.DEMO_CHECKOUT_STRIPE_KEY;
    if (!key) {
      throw new Error("DEMO_CHECKOUT_STRIPE_KEY is not set. See docs/CARDS.md 'Demo checkout'.");
    }
    cached = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return cached;
}

export interface DemoCheckout {
  url: string;
  paymentIntentId: string | null;
  amountCents: number;
  description: string;
}

export async function createCheckout(input: {
  amountCents: number;
  description: string;
}): Promise<DemoCheckout> {
  const amount = Math.round(input.amountCents);
  if (!Number.isFinite(amount) || amount < 50) {
    throw new Error("amount_cents must be at least 50 (Stripe's minimum charge).");
  }
  if (amount > MAX_AMOUNT_CENTS) {
    throw new Error(`amount_cents must be at most ${MAX_AMOUNT_CENTS} for a demo checkout.`);
  }

  const session = await client().checkout.sessions.create({
    mode: "payment",
    success_url: process.env.DEMO_CHECKOUT_SUCCESS_URL ?? "https://getvouch.club",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          product_data: { name: input.description },
        },
      },
    ],
    // The whole point — authorize only. Nothing is ever captured.
    payment_intent_data: { capture_method: "manual" },
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL.");
  }
  return {
    url: session.url,
    paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
    amountCents: amount,
    description: input.description,
  };
}

export interface VoidResult {
  status: string;
  amountCents: number;
}

/**
 * Releases the hold on an uncaptured authorization.
 *
 * Cancelling an uncaptured PaymentIntent is immediate and leaves nothing to
 * reclaim, which is why the demo uses this instead of charging and
 * refunding — a refund moves real money and takes days to come back.
 */
export async function voidPayment(paymentIntentId: string): Promise<VoidResult> {
  const intent = await client().paymentIntents.cancel(paymentIntentId);
  return { status: intent.status, amountCents: intent.amount };
}

/** Reads back an authorization's state, for showing what the card did. */
export async function getPayment(paymentIntentId: string): Promise<VoidResult> {
  const intent = await client().paymentIntents.retrieve(paymentIntentId);
  return { status: intent.status, amountCents: intent.amount };
}
