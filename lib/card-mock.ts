// Mock card issuance, for when Stripe Issuing isn't usable.
//
// This account's Stripe Issuing Financial Account is stuck in `pending`
// (Stripe's own error: "You cannot create a new card ... because its status
// is pending"), so every real issuance attempt fails and nothing downstream
// of a card — simulate_purchase, the webhook, transactions on the dashboard
// — can be exercised at all. Rather than leaving the whole flow untestable
// while that provisioning clears, CARD_ISSUING_MODE=mock swaps Stripe out
// for this module and keeps everything else identical.
//
// Mock cards are ordinary `issued_cards` rows, marked by a MOCK_PREFIX
// stripe_card_id. That's deliberate: list, freeze, unfreeze, cancel, the
// dashboard, and the transactions table are all DB-backed and need no
// knowledge of any of this. Only the four functions that actually call
// Stripe branch (see lib/stripe.ts), so a mock and a real card can coexist
// in the same account and each is routed by its own id.
//
// The generated PAN is NOT a card number. It is random digits behind
// Stripe's well-known 4242 test prefix, it is never sent to any payment
// network, and it authorizes nothing. It is returned once at creation (and
// never stored) purely so an agent has something card-shaped to show.
import { randomInt, randomUUID } from "node:crypto";
import { pool } from "@/lib/db";
import type { User } from "@/lib/auth";

export const MOCK_PREFIX = "ic_mock_";

/** Explicit opt-in. Defaults to live so a missing env var can never silently mint fake cards. */
export function isMockIssuing(): boolean {
  return process.env.CARD_ISSUING_MODE === "mock";
}

export function isMockCard(stripeCardId: string): boolean {
  return stripeCardId.startsWith(MOCK_PREFIX);
}

/**
 * A fixed demo card, supplied by env rather than written into this file.
 *
 * Set MOCK_CARD_NUMBER and every mock issuance returns the same card, which
 * is what a live demo wants — the same recognisable number on screen each
 * time instead of a new random one. Unset, each card gets a fresh
 * 4242-prefixed number.
 *
 * Kept as config, not a literal, for one practical reason: a card number in
 * source is a card number in git history, on GitHub, and in every clone
 * from then on, and the only way to take it back is rewriting history. In
 * env it changes with one command and never enters the repo.
 */
function fixedCard(): { number: string; cvc: string; expMonth: number; expYear: number } | null {
  const number = process.env.MOCK_CARD_NUMBER?.replace(/\s+/g, "");
  if (!number) return null;
  const now = new Date();
  return {
    number,
    cvc: process.env.MOCK_CARD_CVC ?? "000",
    expMonth: Number(process.env.MOCK_CARD_EXP_MONTH) || now.getMonth() + 1,
    expYear: Number(process.env.MOCK_CARD_EXP_YEAR) || now.getFullYear() + 3,
  };
}

function generatePan(): string {
  // 4242 + 12 random digits. Same prefix Stripe's own test cards use, so it
  // is recognisably not a real number to anyone who would know.
  let pan = "4242";
  for (let i = 0; i < 12; i++) pan += randomInt(0, 10);
  return pan;
}

export interface MockCardSecrets {
  /** Shown once at creation and never persisted — see the module comment. */
  number: string;
  cvc: string;
  /**
   * True when the number came from MOCK_CARD_NUMBER — a real card the
   * operator provisioned elsewhere — rather than being randomly generated
   * here. Callers use this to decide how to describe the card: the
   * "this number is random and authorizes nothing" caveat is true of a
   * generated one and false of a pinned one, so it must not be shown for
   * both.
   */
  pinned: boolean;
}

export async function createMockCard(
  user: User,
  input: { label: string; merchant?: string; spendingLimitCents?: number; singleUse?: boolean },
): Promise<{ row: Record<string, unknown>; secrets: MockCardSecrets }> {
  const fixed = fixedCard();
  const pan = fixed?.number ?? generatePan();
  const cvc = fixed?.cvc ?? String(randomInt(100, 1000));
  const now = new Date();
  const expMonth = fixed?.expMonth ?? now.getMonth() + 1;
  const expYear = fixed?.expYear ?? now.getFullYear() + 3;

  const result = await pool.query(
    `insert into issued_cards
       (user_id, stripe_card_id, label, merchant, last4, brand, exp_month, exp_year, status, spending_limit_cents, single_use)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning *`,
    [
      user.id,
      `${MOCK_PREFIX}${randomUUID()}`,
      input.label,
      input.merchant ?? null,
      pan.slice(-4),
      "Visa",
      expMonth,
      expYear,
      "active",
      input.spendingLimitCents ?? null,
      input.singleUse ?? true,
    ],
  );
  return { row: result.rows[0], secrets: { number: pan, cvc, pinned: fixed !== null } };
}

export interface MockPurchaseResult {
  approved: boolean;
  authorizationId: string;
  declineReason?: string;
  autoCanceled: boolean;
}

/**
 * Local stand-in for Stripe's authorization decision.
 *
 * Mirrors the three rules Stripe would apply to these cards — a canceled
 * card declines, a frozen card declines, and an amount over the card's
 * spending limit declines as "spending_controls" — then records the
 * transaction and auto-cancels a single-use card, which is what the real
 * webhook handler does on `issuing_transaction.created`. There is no
 * webhook for a mock purchase (nothing external fires one), so this does
 * that bookkeeping inline.
 */
export async function simulateMockPurchase(
  userId: string,
  input: { cardId: string; amountCents: number; merchantName?: string },
): Promise<MockPurchaseResult> {
  const existing = await pool.query<{
    id: string;
    stripe_card_id: string;
    status: "active" | "inactive" | "canceled";
    spending_limit_cents: number | null;
    single_use: boolean;
  }>(
    `select id, stripe_card_id, status, spending_limit_cents, single_use
     from issued_cards where id = $1 and user_id = $2`,
    [input.cardId, userId],
  );
  if (existing.rows.length === 0) throw new Error("Card not found");
  const card = existing.rows[0];
  const authorizationId = `iauth_mock_${randomUUID()}`;

  if (card.status === "canceled") {
    return { approved: false, authorizationId, declineReason: "card_canceled", autoCanceled: false };
  }
  if (card.status === "inactive") {
    return { approved: false, authorizationId, declineReason: "card_inactive", autoCanceled: false };
  }
  if (card.spending_limit_cents !== null && input.amountCents > card.spending_limit_cents) {
    return { approved: false, authorizationId, declineReason: "spending_controls", autoCanceled: false };
  }

  await pool.query(
    `insert into card_transactions (card_id, stripe_transaction_id, amount_cents, merchant_name, occurred_at)
     values ($1,$2,$3,$4,now())
     on conflict (stripe_transaction_id) do nothing`,
    [card.id, `itxn_mock_${randomUUID()}`, input.amountCents, input.merchantName ?? null],
  );

  let autoCanceled = false;
  if (card.single_use) {
    await pool.query("update issued_cards set status = 'canceled', updated_at = now() where id = $1", [card.id]);
    autoCanceled = true;
  }
  return { approved: true, authorizationId, autoCanceled };
}
