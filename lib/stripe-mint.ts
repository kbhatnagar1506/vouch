// Self-contained copy of the card-issuing branch's lib/stripe.ts, trimmed
// to only what the "Mint card & renew" / "Keep it dead" decision actions
// need (create + cancel). Per this repo's convention (see root CLAUDE.md
// "Service branches"), branches don't share code across branches even
// though they share the DB — card-issuing owns the full cardholder/card
// management UI (freeze/unfreeze/reveal); this branch only ever creates or
// cancels a card as a side effect of a renew/hold decision.
//
// Cards minted here land in the same `issued_cards` table and the same
// Stripe account as card-issuing, so card-issuing's webhook (already
// deployed there) still auto-cancels them on their first transaction —
// nothing extra to wire up on this branch for that.
import Stripe from "stripe";
import { pool } from "@/lib/db";
import type { User } from "@/lib/auth";

const STRIPE_API_VERSION = "2024-12-18.acacia" satisfies Stripe.LatestApiVersion;

let cachedClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!cachedClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set. See card-issuing's docs/CARDS.md.");
    }
    cachedClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return cachedClient;
}

export class PhoneNumberRequiredError extends Error {
  constructor() {
    super("A phone number is required to set up card issuance (Stripe uses it for 3D Secure).");
    this.name = "PhoneNumberRequiredError";
  }
}

function splitName(name: string, emailFallback: string): { firstName: string; lastName: string } {
  const trimmed = name.trim();
  if (!trimmed) {
    const local = emailFallback.split("@")[0] || "Vouch";
    return { firstName: local, lastName: local };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function ensureCardholder(user: User, opts: { phoneNumber?: string; termsAcceptanceIp: string }): Promise<string> {
  const existing = await pool.query<{ stripe_cardholder_id: string }>(
    "select stripe_cardholder_id from stripe_cardholders where user_id = $1",
    [user.id],
  );
  if (existing.rows.length > 0) return existing.rows[0].stripe_cardholder_id;

  if (!opts.phoneNumber) {
    throw new PhoneNumberRequiredError();
  }

  const { firstName, lastName } = splitName(user.name, user.email);
  const stripe = getStripeClient();
  const cardholder = await stripe.issuing.cardholders.create({
    type: "individual",
    name: user.name || user.email,
    email: user.email,
    phone_number: opts.phoneNumber,
    billing: {
      address: { line1: "185 Berry St", city: "San Francisco", state: "CA", postal_code: "94107", country: "US" },
    },
    individual: {
      first_name: firstName,
      last_name: lastName,
      card_issuing: {
        user_terms_acceptance: { date: Math.floor(Date.now() / 1000), ip: opts.termsAcceptanceIp },
      },
    },
  });

  const inserted = await pool.query<{ stripe_cardholder_id: string }>(
    `insert into stripe_cardholders (user_id, stripe_cardholder_id)
     values ($1, $2)
     on conflict (user_id) do update set stripe_cardholder_id = stripe_cardholders.stripe_cardholder_id
     returning stripe_cardholder_id`,
    [user.id, cardholder.id],
  );
  return inserted.rows[0].stripe_cardholder_id;
}

function getIssuingFinancialAccountId(): string {
  const id = process.env.STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID;
  if (!id) {
    throw new Error("STRIPE_ISSUING_FINANCIAL_ACCOUNT_ID is not set. See card-issuing's docs/CARDS.md.");
  }
  return id;
}

export interface MintCardInput {
  label: string;
  merchant: string;
  spendingLimitCents?: number;
  phoneNumber?: string;
  termsAcceptanceIp: string;
}

export interface MintedCard {
  id: string;
  stripeCardId: string;
  last4: string;
  brand: string;
}

/** Issues a fresh single-use virtual card for a subscription's next charge. */
export async function mintCard(user: User, input: MintCardInput): Promise<MintedCard> {
  const stripe = getStripeClient();
  const cardholderId = await ensureCardholder(user, { phoneNumber: input.phoneNumber, termsAcceptanceIp: input.termsAcceptanceIp });

  const card = await stripe.issuing.cards.create({
    cardholder: cardholderId,
    currency: "usd",
    type: "virtual",
    status: "active",
    spending_controls: input.spendingLimitCents
      ? { spending_limits: [{ amount: input.spendingLimitCents, interval: "all_time" }] }
      : undefined,
    // Untyped in this SDK version — see card-issuing's docs/CARDS.md "Financial account".
    ...({ financial_account_v2: getIssuingFinancialAccountId() } as Record<string, string>),
  });

  const result = await pool.query<{ id: string }>(
    `insert into issued_cards
       (user_id, stripe_card_id, label, merchant, last4, brand, exp_month, exp_year, status, spending_limit_cents, single_use)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
     returning id`,
    [user.id, card.id, input.label, input.merchant, card.last4, card.brand, card.exp_month, card.exp_year, card.status, input.spendingLimitCents ?? null],
  );

  return { id: result.rows[0].id, stripeCardId: card.id, last4: card.last4, brand: card.brand };
}

/** Cancels a still-active card outright — the "Keep it dead" decision. Terminal, matching card-issuing's cancelCard. */
export async function cancelCardByStripeId(userId: string, stripeCardId: string): Promise<void> {
  const stripe = getStripeClient();
  await stripe.issuing.cards.update(stripeCardId, { status: "canceled" });
  await pool.query(
    "update issued_cards set status = 'canceled', updated_at = now() where stripe_card_id = $1 and user_id = $2",
    [stripeCardId, userId],
  );
}
