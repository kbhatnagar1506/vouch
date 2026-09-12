import { NextResponse } from "next/server";
import {
  createUser,
  createSessionToken,
  getUserByEmail,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }
  if (!password || password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  try {
    if (await getUserByEmail(email)) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const user = await createUser(email, password);
    const token = await createSessionToken(user.id);

    const response = NextResponse.json({ ok: true, user });
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to sign up" },
      { status: 500 },
    );
  }
}
