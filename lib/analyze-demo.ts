// Usage-based verdict/value scoring, ported verbatim from vouch-ui's
// Analysis.jsx `analyze()`. Demo-only: it leans on usage30/usageUnit,
// which only ever exist on the seeded data (see lib/seed.ts and
// docs/DASHBOARD.md) — the real dashboard uses lib/analyze-real.ts instead.
import type { Analysis, Subscription } from "@/lib/dashboard-types";

export function analyzeDemo(s: Subscription): Analysis {
  const usage30 = s.usage30 ?? 0;
  const usageUnit = s.usageUnit ?? "uses";
  const priceChange = s.priceChange ?? 0;
  const usePerDollar = usage30 / Math.max(s.price, 1);
  const annual = (s.price * 12).toFixed(0);
  let verdict: Analysis["verdict"];
  let tone: Analysis["tone"];
  let worth: number;
  let headline: string;
  let factors: Analysis["factors"];

  if (usage30 === 0) {
    verdict = "Cancel";
    tone = "cancel";
    worth = 0;
    headline = `You haven't used ${s.name} in over 30 days, but it costs $${s.price.toFixed(2)}/mo ($${annual}/yr).`;
    factors = [
      { good: false, text: `Zero ${usageUnit} in the last 30 days` },
      { good: false, text: priceChange > 0 ? `Price rose ${priceChange}% recently` : `You're paying full price for no usage` },
      s.overlap
        ? { good: false, text: `Overlaps with ${s.overlap}, which you also pay for` }
        : { good: false, text: `Cancelling frees $${annual}/yr` },
    ];
  } else if (priceChange > 15 && usePerDollar < 1) {
    verdict = "Review";
    tone = "hold";
    worth = Math.round(s.price * 0.4);
    headline = `${s.name} raised its price ${priceChange}% while your usage stayed low — it may no longer be worth $${s.price.toFixed(2)}/mo.`;
    factors = [
      { good: false, text: `Only ${usage30} ${usageUnit} in 30 days` },
      { good: false, text: `Price jumped ${priceChange}% in the last 90 days` },
      { good: true, text: `Still some usage — worth a look before cancelling` },
    ];
  } else if (usePerDollar >= 2) {
    verdict = "Keep";
    tone = "renew";
    worth = Math.round(s.price * 1.6);
    headline = `You get strong value from ${s.name} — ${usage30} ${usageUnit} for $${s.price.toFixed(2)}/mo is well below what you'd pay per use elsewhere.`;
    factors = [
      { good: true, text: `${usage30} ${usageUnit} in 30 days — heavy use` },
      { good: true, text: priceChange > 0 ? `Price up ${priceChange}%, but usage justifies it` : `Price held steady` },
      { good: true, text: s.trend === "up" ? `Usage trending up` : `Consistent monthly usage` },
    ];
  } else {
    verdict = "Keep";
    tone = "renew";
    worth = Math.round(s.price * 1.1);
    headline = `${s.name} earns its charge — your usage is steady and the price is fair at $${s.price.toFixed(2)}/mo.`;
    factors = [
      { good: true, text: `${usage30} ${usageUnit} in 30 days` },
      { good: true, text: `Price unchanged over 90 days` },
      { good: true, text: `Usage covers the cost` },
    ];
  }

  const valuePct = Math.min(200, Math.round((worth / s.price) * 100));
  return { verdict, tone, worth, valuePct, headline, factors, annual };
}
