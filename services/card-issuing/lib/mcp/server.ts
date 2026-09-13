import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { User } from "@/lib/auth";
import { createCheckout, isCheckoutConfigured, voidPayment } from "@/lib/demo-checkout";
import {
  cancelCard,
  createVirtualCardWithSecrets,
  freezeCard,
  listCards,
  PhoneNumberRequiredError,
  simulatePurchase,
  unfreezeCard,
} from "@/lib/stripe";

const CARD_SHAPE = {
  id: z.string(),
  label: z.string(),
  merchant: z.string().nullable(),
  last4: z.string(),
  brand: z.string(),
  expMonth: z.number(),
  expYear: z.number(),
  status: z.enum(["active", "inactive", "canceled"]),
  spendingLimitCents: z.number().nullable(),
  singleUse: z.boolean(),
};

function cardText(card: { label: string; brand: string; last4: string; status: string }): string {
  return `${card.label || "(unlabeled)"}: ${card.brand} ····${card.last4} (${card.status})`;
}

/**
 * Builds a fresh McpServer, its tools closing over `user` and `termsAcceptanceIp`
 * for this one request. Cheap enough to construct per-request -- see
 * app/api/mcp/route.ts, which does exactly that instead of keeping any
 * server instance alive across requests (this app runs on Vercel's
 * serverless functions; nothing survives between invocations to keep alive).
 *
 * The security model this implements throughout: every tool here returns
 * only what Stripe's own card object already treats as non-sensitive
 * (last4, brand, expiry, status) -- never the PAN/CVC. Same guarantee
 * lib/stripe.ts already gives the human-facing /cards UI (see docs/CARDS.md
 * "PCI scope"); this MCP server doesn't loosen it for agents.
 */
export function buildMcpServer(user: User, termsAcceptanceIp: string): McpServer {
  const server = new McpServer({ name: "vouch-card-issuing", version: "1.0.0" });

  server.registerTool(
    "create_temporary_card",
    {
      title: "Create a temporary card",
      description:
        "Issues a new virtual card via Stripe Issuing for a specific intended purchase. Single-use by default: it auto-cancels the instant its first transaction posts, so it can never be charged twice. Never returns the card number/CVC -- only Stripe's own non-sensitive metadata (last4, brand, expiry). Use simulate_purchase with the returned card id to actually attempt a charge.",
      inputSchema: {
        label: z.string().describe("A short human-readable label, e.g. the merchant or purpose (\"Acme Hardware\")."),
        merchant: z.string().optional().describe("Optional: the specific merchant this card is scoped for, for your own records."),
        spending_limit_cents: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional cap, in cents, on the single transaction this card will ever authorize."),
        single_use: z.boolean().optional().describe("Default true. Pass false only for a deliberately long-lived card."),
        phone_number: z
          .string()
          .optional()
          .describe("Required only the first time this user creates a card (Stripe needs it for 3D Secure). Omit on later calls."),
      },
      outputSchema: {
        card: z.object(CARD_SHAPE).optional(),
        phone_required: z.boolean().optional(),
        // Returned only when this deployment hands out a card number
        // directly (CARD_ISSUING_MODE=mock). A card issued through Stripe
        // never returns its PAN here — that stays out of the server
        // entirely and is revealed client-side via an ephemeral key.
        card_number: z.string().optional(),
        cvc: z.string().optional(),
        // True only for a locally generated number, which authorizes
        // nothing. A pinned card (MOCK_CARD_NUMBER) is a real card the
        // operator provisioned, so it is not flagged.
        generated: z.boolean().optional(),
      },
    },
    async ({ label, merchant, spending_limit_cents, single_use, phone_number }) => {
      try {
        const { card, secrets } = await createVirtualCardWithSecrets(user, {
          label,
          merchant,
          spendingLimitCents: spending_limit_cents,
          singleUse: single_use,
          phoneNumber: phone_number,
          termsAcceptanceIp,
        });
        if (secrets) {
          return {
            content: [
              {
                type: "text",
                // The "authorizes nothing" caveat is true of a number
                // generated here and false of a pinned one, so it's shown
                // only for the former rather than blanket-applied to both.
                text:
                  `Created card: ${cardText(card)}\n` +
                  `Number ${secrets.number}  exp ${String(card.expMonth).padStart(2, "0")}/${card.expYear}  CVC ${secrets.cvc}` +
                  (secrets.pinned ? "" : "\n(Test number generated locally — it authorizes nothing.)"),
              },
            ],
            structuredContent: {
              card,
              card_number: secrets.number,
              cvc: secrets.cvc,
              generated: !secrets.pinned,
            },
          };
        }
        return {
          content: [{ type: "text", text: `Created card: ${cardText(card)}` }],
          structuredContent: { card },
        };
      } catch (error) {
        if (error instanceof PhoneNumberRequiredError) {
          return {
            content: [{ type: "text", text: "A phone number is required to set up card issuance for this user. Retry with phone_number set." }],
            structuredContent: { phone_required: true },
          };
        }
        throw error;
      }
    },
  );

  server.registerTool(
    "list_cards",
    {
      title: "List cards",
      description: "Lists every card this user has issued, newest first, with status and remaining-use info. No card numbers.",
      outputSchema: { cards: z.array(z.object(CARD_SHAPE)) },
    },
    async () => {
      const cards = await listCards(user.id);
      const summary = cards.length === 0 ? "No cards yet." : cards.map(cardText).join("\n");
      return { content: [{ type: "text", text: summary }], structuredContent: { cards } };
    },
  );

  server.registerTool(
    "freeze_card",
    {
      title: "Freeze a card",
      description: "Reversible: blocks new authorizations on this card without giving up the card number or canceling it.",
      inputSchema: { card_id: z.string() },
      outputSchema: { card: z.object(CARD_SHAPE) },
    },
    async ({ card_id }) => {
      const card = await freezeCard(user.id, card_id);
      return { content: [{ type: "text", text: `Frozen: ${cardText(card)}` }], structuredContent: { card } };
    },
  );

  server.registerTool(
    "unfreeze_card",
    {
      title: "Unfreeze a card",
      description: "Reverses freeze_card, re-enabling authorizations.",
      inputSchema: { card_id: z.string() },
      outputSchema: { card: z.object(CARD_SHAPE) },
    },
    async ({ card_id }) => {
      const card = await unfreezeCard(user.id, card_id);
      return { content: [{ type: "text", text: `Unfrozen: ${cardText(card)}` }], structuredContent: { card } };
    },
  );

  server.registerTool(
    "cancel_card",
    {
      title: "Cancel a card",
      description: "Terminal -- Stripe does not allow un-canceling a card. The merchant's next charge attempt (a subscription renewal, anything) will be declined.",
      inputSchema: { card_id: z.string() },
      outputSchema: { card: z.object(CARD_SHAPE) },
    },
    async ({ card_id }) => {
      const card = await cancelCard(user.id, card_id);
      return { content: [{ type: "text", text: `Canceled: ${cardText(card)}` }], structuredContent: { card } };
    },
  );

  server.registerTool(
    "simulate_purchase",
    {
      title: "Simulate a purchase",
      description:
        "Test-mode only. Drives a real Stripe Issuing authorization against the card's actual spending limit and status -- Stripe itself decides approve/decline, exactly as a live merchant charge would. An approved purchase is captured immediately, which auto-cancels a single-use card, same as a real transaction posting. There is no way to charge an arbitrary real-world online merchant through this tool; it only tests/exercises this card's own authorization rules.",
      inputSchema: {
        card_id: z.string(),
        amount_cents: z.number().int().positive(),
        merchant_name: z.string().optional(),
      },
      outputSchema: {
        approved: z.boolean(),
        authorization_id: z.string(),
        decline_reason: z.string().optional(),
      },
    },
    async ({ card_id, amount_cents, merchant_name }) => {
      const result = await simulatePurchase(user.id, { cardId: card_id, amountCents: amount_cents, merchantName: merchant_name });
      const text = result.approved
        ? `Approved and captured (authorization ${result.authorizationId}).`
        : `Declined (${result.declineReason ?? "unknown reason"}).`;
      return {
        content: [{ type: "text", text }],
        structuredContent: { approved: result.approved, authorization_id: result.authorizationId, decline_reason: result.declineReason },
      };
    },
  );

  // Registered only when a checkout account is configured — without it these
  // would be dead tools an agent keeps trying and failing to use.
  if (isCheckoutConfigured()) {
    server.registerTool(
      "create_checkout",
      {
        title: "Create a checkout page to pay a card on",
        description:
          "Creates a Stripe Checkout page that a card from create_temporary_card can be paid on, and returns its URL. AUTHORIZATION ONLY: the payment is created with manual capture and is never captured, so no money is taken — it exists to put a real authorization on the card (which is what makes the issuing webhook fire and a single-use card auto-cancel). Release it afterwards with void_checkout.",
        inputSchema: {
          amount_cents: z.number().int().min(50).max(5000).describe("Amount to authorize, in cents. Minimum 50, maximum 5000."),
          description: z
            .string()
            .describe("What the line item is called on the checkout page. Use a plain description; do not name a company that isn't the operator."),
        },
        outputSchema: {
          url: z.string(),
          payment_intent_id: z.string().nullable(),
          amount_cents: z.number(),
        },
      },
      async ({ amount_cents, description }) => {
        const checkout = await createCheckout({ amountCents: amount_cents, description });
        return {
          content: [
            {
              type: "text",
              text:
                `Checkout ready for $${(checkout.amountCents / 100).toFixed(2)} — ${checkout.description}\n` +
                `${checkout.url}\n` +
                `Pay it with the card, then release the hold with void_checkout (payment_intent_id ${checkout.paymentIntentId ?? "unknown"}). Nothing is captured.`,
            },
          ],
          structuredContent: {
            url: checkout.url,
            payment_intent_id: checkout.paymentIntentId,
            amount_cents: checkout.amountCents,
          },
        };
      },
    );

    server.registerTool(
      "void_checkout",
      {
        title: "Release a checkout authorization",
        description:
          "Cancels an uncaptured payment, releasing the hold on the card immediately. Nothing was ever captured, so there is no refund to wait for.",
        inputSchema: { payment_intent_id: z.string().describe("From create_checkout.") },
        outputSchema: { status: z.string(), amount_cents: z.number() },
      },
      async ({ payment_intent_id }) => {
        const result = await voidPayment(payment_intent_id);
        return {
          content: [
            { type: "text", text: `Released $${(result.amountCents / 100).toFixed(2)} — payment is now ${result.status}. Nothing was captured.` },
          ],
          structuredContent: { status: result.status, amount_cents: result.amountCents },
        };
      },
    );
  }

  return server;
}
