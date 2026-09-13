import { redirect } from "next/navigation";

// This branch owns identity.getvouch.club and has exactly one page worth
// visiting. middleware.ts gates /verify and sends signed-out visitors to the
// portal's login. The scaffold's DB health check is still at /api/health.
export default function Home() {
  redirect("/verify");
}
