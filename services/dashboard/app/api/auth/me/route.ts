import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user: user ? { id: user.id, email: user.email, name: user.name } : null });
}
