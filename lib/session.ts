import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken, getUserById, type User } from "@/lib/auth";

/** For use in Server Components and Route Handlers (reads via next/headers). */
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  return getUserById(userId);
}

/** Same as getCurrentUser, but 401s instead of returning null — for API routes that require auth. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Not authenticated");
    this.name = "UnauthorizedError";
  }
}
