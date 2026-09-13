import Stripe from "stripe";
import { pool } from "@/lib/db";
import type { User } from "@/lib/auth";

// Pinned explicitly (matching this installed `stripe` package version's
// own LatestApiVersion type) rather than left to the SDK's default, since
// createCardEphemeralKey below needs this exact string again -- an
// ephemeral key's apiVersion has to match what Stripe.js on the client
// expects, and there's no public runtime constant to read it back from
// the client instance itself.
const STRIPE_API_VERSION = "2024-12-18.acacia" satisfies Stripe.LatestApiVersion;

let cachedClient: Stripe | null = null;

function getStripeClient(): Stripe {
  if (!cachedClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set. See docs/CARDS.md.");
    }
    cachedClient = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }
  return cachedClient;
}

/**
 * Stripe scopes card issuance per-cardholder. Each Vouch user gets exactly
 * one, created lazily on first card request and cached in
 * stripe_cardholders -- same pattern as gmail-connector's
 * ensureBackboardAssistant().
 *
 * Test-mode cardholders still require a billing address; since this is
 * sandbox-only for now, a placeholder US address is used when the user
 * hasn't supplied a real one. Swap this for real billing details before
 * any production (non-test-mode) use -- Stripe will reject a live
 * cardholder with obviously fake address data.
 */
export async function ensureCardholder(user: User): Promise<string> {
  const existing = await pool.query<{ stripe_cardholder_id: string }>(
    "select stripe_cardholder_id from stripe_cardholders where user_id = $1",
    [user.id],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].stripe_cardholder_id;
  }

  const stripe = getStripeClient();
  const cardholder = await stripe.issuing.cardholders.create({
    type: "individual",
    name: user.name || user.email,
    email: user.email,
    billing: {
      address: {
        line1: "185 Berry St",
        city: "San Francisco",
        state: "CA",
        postal_code: "94107",
        country: "US",
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

export interface IssuedCard {
  id: string;
  stripeCardId: string;
  label: string;
  merchant: string | null;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
  status: "active" | "inactive" | "canceled";
  spendingLimitCents: number | null;
  singleUse: boolean;
  createdAt: Date;
}

interface IssuedCardRow {
  id: string;
  stripe_card_id: string;
  label: string;
  merchant: string | null;
  last4: string;
  brand: string;
  exp_month: number;
  exp_year: number;
  status: "active" | "inactive" | "canceled";
  spending_limit_cents: number | null;
  single_use: boolean;
  created_at: Date;
}

function rowToCard(row: IssuedCardRow): IssuedCard {
  return {
    id: row.id,
    stripeCardId: row.stripe_card_id,
    label: row.label,
    merchant: row.merchant,
    last4: row.last4,
    brand: row.brand,
    expMonth: row.exp_month,
    expYear: row.exp_year,
    status: row.status,
    spendingLimitCents: row.spending_limit_cents,
    singleUse: row.single_use,
    createdAt: row.created_at,
  };
}

export interface CreateCardInput {
  label: string;
  merchant?: string;
  /** Caps the one transaction this card will ever authorize before the webhook auto-cancels it. */
  spendingLimitCents?: number;
  /**
   * Default true: a fresh, disposable card per transaction is the normal
   * issuance model here (see docs/CARDS.md "Single-use by default"). Pass
   * false only for a deliberately long-lived card.
   */
  singleUse?: boolean;
}

/** Issues a new virtual card (no physical fulfillment) and records it locally. */
export async function createVirtualCard(user: User, input: CreateCardInput): Promise<IssuedCard> {
  const stripe = getStripeClient();
  const cardholderId = await ensureCardholder(user);
  const singleUse = input.singleUse ?? true;

  const card = await stripe.issuing.cards.create({
    cardholder: cardholderId,
    currency: "usd",
    type: "virtual",
    status: "active",
    spending_controls: input.spendingLimitCents
      ? { spending_limits: [{ amount: input.spendingLimitCents, interval: "all_time" }] }
      : undefined,
  });

  const result = await pool.query<IssuedCardRow>(
    `insert into issued_cards
       (user_id, stripe_card_id, label, merchant, last4, brand, exp_month, exp_year, status, spending_limit_cents, single_use)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning *`,
    [
      user.id,
      card.id,
      input.label,
      input.merchant ?? null,
      card.last4,
      card.brand,
      card.exp_month,
      card.exp_year,
      card.status,
      input.spendingLimitCents ?? null,
      singleUse,
    ],
  );
  return rowToCard(result.rows[0]);
}

export async function listCards(userId: string): Promise<IssuedCard[]> {
  const result = await pool.query<IssuedCardRow>(
    "select * from issued_cards where user_id = $1 order by created_at desc",
    [userId],
  );
  return result.rows.map(rowToCard);
}

async function updateCardStatus(
  userId: string,
  cardId: string,
  status: "active" | "inactive" | "canceled",
): Promise<IssuedCard> {
  const existing = await pool.query<{ stripe_card_id: string }>(
    "select stripe_card_id from issued_cards where id = $1 and user_id = $2",
    [cardId, userId],
  );
  if (existing.rows.length === 0) {
    throw new Error("Card not found");
  }

  const stripe = getStripeClient();
  await stripe.issuing.cards.update(existing.rows[0].stripe_card_id, { status });

  const updated = await pool.query<IssuedCardRow>(
    "update issued_cards set status = $1, updated_at = now() where id = $2 returning *",
    [status, cardId],
  );
  return rowToCard(updated.rows[0]);
}

/** Reversible -- blocks new authorizations without giving up the card number. */
export function freezeCard(userId: string, cardId: string): Promise<IssuedCard> {
  return updateCardStatus(userId, cardId, "inactive");
}

export function unfreezeCard(userId: string, cardId: string): Promise<IssuedCard> {
  return updateCardStatus(userId, cardId, "active");
}

/**
 * Terminal -- the whole point for a subscription card: cancel this and the
 * merchant's next charge attempt is declined, no need to deal with them
 * directly. Stripe does not allow un-canceling a card.
 */
export function cancelCard(userId: string, cardId: string): Promise<IssuedCard> {
  return updateCardStatus(userId, cardId, "canceled");
}

/**
 * Short-lived (~30 min) key scoped to exactly one card, used client-side
 * with Stripe.js's Issuing Elements to reveal the real PAN/CVC/expiry in
 * the browser. The raw card number never touches our server or database --
 * that's the whole reason this exists instead of a `getCardNumber()`
 * server function. See docs/CARDS.md "PCI scope".
 */
export async function createCardEphemeralKey(userId: string, cardId: string): Promise<{ stripeCardId: string; ephemeralKeySecret: string }> {
  const existing = await pool.query<{ stripe_card_id: string }>(
    "select stripe_card_id from issued_cards where id = $1 and user_id = $2",
    [cardId, userId],
  );
  if (existing.rows.length === 0) {
    throw new Error("Card not found");
  }
  const stripeCardId = existing.rows[0].stripe_card_id;

  const stripe = getStripeClient();
  const key = await stripe.ephemeralKeys.create({ issuing_card: stripeCardId }, { apiVersion: STRIPE_API_VERSION });

  return { stripeCardId, ephemeralKeySecret: key.secret as string };
}

export function verifyWebhookSignature(rawBody: string, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET is not set. See docs/CARDS.md.");
  }
  return getStripeClient().webhooks.constructEvent(rawBody, signature, secret);
}

/**
 * Records a posted transaction and, for a single-use card, immediately
 * cancels it via Stripe -- this is what actually makes "one card per
 * transaction" real rather than just a label: the instant the first
 * charge lands, the card is dead, so a merchant's next attempt (a
 * subscription renewal, a retried charge, anything) is declined at
 * Stripe's end. Returns whether this call was the one that canceled it,
 * so the webhook handler can log it.
 */
export async function recordCardTransaction(params: {
  stripeCardId: string;
  stripeTransactionId: string;
  amountCents: number;
  merchantName: string | null;
  occurredAt: Date;
}): Promise<{ autoCanceled: boolean }> {
  const card = await pool.query<{ id: string; status: IssuedCard["status"]; single_use: boolean }>(
    "select id, status, single_use from issued_cards where stripe_card_id = $1",
    [params.stripeCardId],
  );
  if (card.rows.length === 0) {
    // A transaction on a card this DB doesn't know about (e.g. issued
    // directly in the Stripe dashboard) -- nothing to attach it to.
    return { autoCanceled: false };
  }
  const { id: cardId, status, single_use: singleUse } = card.rows[0];

  const inserted = await pool.query(
    `insert into card_transactions (card_id, stripe_transaction_id, amount_cents, merchant_name, occurred_at)
     values ($1,$2,$3,$4,$5)
     on conflict (stripe_transaction_id) do nothing
     returning id`,
    [cardId, params.stripeTransactionId, params.amountCents, params.merchantName, params.occurredAt],
  );
  // Already recorded (Stripe retried the webhook delivery) -- the first
  // delivery already triggered (or will trigger) the cancel, so don't redo it.
  if (inserted.rows.length === 0) {
    return { autoCanceled: false };
  }

  if (singleUse && status === "active") {
    const stripe = getStripeClient();
    await stripe.issuing.cards.update(params.stripeCardId, { status: "canceled" });
    await pool.query("update issued_cards set status = 'canceled', updated_at = now() where id = $1", [cardId]);
    return { autoCanceled: true };
  }
  return { autoCanceled: false };
}
