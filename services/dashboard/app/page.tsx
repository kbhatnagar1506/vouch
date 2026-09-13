import { redirect } from "next/navigation";

// This branch owns dashboard.getvouch.club, so the bare domain should open
// the dashboard — it was still showing the scaffold's DB health-check page,
// which is what the onboarding chain landed on after voice enrollment
// (NEXT_PUBLIC_DASHBOARD_URL points at the bare domain). The health check
// itself is still available at /api/health.
//
// Safe to send everyone here: middleware.ts gates /dashboard and redirects
// signed-out visitors to the portal's login.
export default function Home() {
  redirect("/dashboard");
}
