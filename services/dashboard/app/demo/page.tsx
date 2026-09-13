// Public, unauthenticated showcase of the full dashboard UI using
// vouch-ui's original mock data (usage numbers, worth scores, all 10
// connectors) verbatim — kept alongside /dashboard's real data, mirroring
// this repo's existing /voice (demo) vs /voice/register (real) split.
import { subscriptions, transactions, budget, connectors, user } from "@/lib/seed";
import { analyzeDemo } from "@/lib/analyze-demo";
import DashboardShell from "@/components/dashboard/DashboardShell";
import type { AnalyzedSubscription } from "@/lib/dashboard-types";

export default function DemoDashboardPage() {
  const analyzed: AnalyzedSubscription[] = subscriptions.map((s) => ({ ...s, ...analyzeDemo(s) }));

  return (
    <DashboardShell mode="demo" initialSubscriptions={analyzed} transactions={transactions} budget={budget} connectors={connectors} user={user} />
  );
}
