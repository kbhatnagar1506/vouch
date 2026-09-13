// Rule-based verdict for real subscriptions — deliberately NOT a port of
// analyze-demo.ts's usage-based scoring, because there is no usage-tracking
// integration for any real service (no plays/rides/sessions signal exists
// anywhere in this codebase). Every input here is a real, measurable
// signal already sitting in the DB:
//   - priceChangePct: % change vs the previous Gmail-recorded charge
//   - hasActiveCard: whether a single-use Stripe card is currently minted
//     and un-canceled for this merchant
//   - renewsInDays: days until the next expected charge, inferred from the
//     last charge date + an assumed ~30 day cycle (null when we've only
//     ever seen one charge and have no cycle to infer)
//
// It never returns tone 'cancel' or verdict 'Cancel': recommending
// cancellation is a real, consequential claim about whether a service is
// worth keeping, and nothing here measures that — only a human (from the
// popup) or a future real usage signal should make that call. See
// docs/DASHBOARD.md "Decision engine" for the full rationale.
import type { Analysis, Factor, SubStatus } from "@/lib/dashboard-types";

export interface RealAnalysisInput {
  name: string;
  price: number;
  priceChangePct: number;
  hasActiveCard: boolean;
  renewsInDays: number | null;
  chargeCount: number;
}

export type RealAnalysis = Analysis & { status: SubStatus };

const DUE_SOON_DAYS = 7;
const PRICE_JUMP_THRESHOLD = 10;

export function analyzeReal(s: RealAnalysisInput): RealAnalysis {
  const annual = (s.price * 12).toFixed(0);
  const priceRose = s.priceChangePct >= PRICE_JUMP_THRESHOLD;
  const dueSoon = s.renewsInDays !== null && s.renewsInDays <= DUE_SOON_DAYS;

  const priceFactor: Factor = priceRose
    ? { good: false, text: `Price rose ${s.priceChangePct}% since your last charge` }
    : s.chargeCount > 1
      ? { good: true, text: `Price unchanged since your last charge` }
      : { good: true, text: `Only one charge on record — no price history yet` };

  const cardFactor: Factor = s.hasActiveCard
    ? { good: true, text: `A single-use card is already minted for the next charge` }
    : { good: false, text: `No active card on file right now` };

  if (priceRose) {
    return {
      status: "ask",
      verdict: "Review",
      tone: "hold",
      headline: `${s.name}'s price rose ${s.priceChangePct}% since your last charge — worth confirming before it renews again at $${s.price.toFixed(2)}/mo.`,
      factors: [priceFactor, cardFactor],
      annual,
    };
  }

  if (!s.hasActiveCard && dueSoon) {
    return {
      status: "ask",
      verdict: "Review",
      tone: "hold",
      headline: `No active card on file, and the next charge for ${s.name} looks due in ${s.renewsInDays} day${s.renewsInDays === 1 ? "" : "s"} — mint one to keep it renewing, or let it lapse.`,
      factors: [cardFactor, priceFactor],
      annual,
    };
  }

  if (s.hasActiveCard) {
    return {
      status: "renew",
      verdict: "Keep",
      tone: "renew",
      headline: `${s.name} is set to renew — a single-use card is already active for the next $${s.price.toFixed(2)} charge.`,
      factors: [cardFactor, priceFactor],
      annual,
    };
  }

  return {
    status: "hold",
    verdict: "Keep",
    tone: "hold",
    headline: `No charge for ${s.name} expected soon${s.renewsInDays !== null ? ` (in ${s.renewsInDays} days)` : ""} — nothing to decide right now.`,
    factors: [cardFactor, priceFactor],
    annual,
  };
}
