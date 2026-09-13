import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getRealDashboardData } from "@/lib/dashboard-data";
import DashboardShell from "@/components/dashboard/DashboardShell";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) {
    // Middleware already handles this for a browser visit; this is only a
    // fallback (e.g. a stale cookie that fails verification mid-request).
    redirect(process.env.PORTAL_LOGIN_URL || "https://login.getvouch.club/login");
  }

  const data = await getRealDashboardData(user);

  return (
    <DashboardShell
      mode="real"
      initialSubscriptions={data.subscriptions}
      transactions={data.transactions}
      budget={data.budget}
      connectors={data.connectors}
      user={data.user}
    />
  );
}
