import { NextResponse } from "next/server";
import { requireUser, UnauthorizedError } from "@/lib/session";
import { getGmailClientForUser } from "@/lib/google";

export async function GET() {
  try {
    const user = await requireUser();

    const client = await getGmailClientForUser(user.id);
    if (!client) {
      return NextResponse.json({ error: "Gmail not connected" }, { status: 409 });
    }

    const list = await client.gmail.users.messages.list({ userId: "me", maxResults: 5 });

    const messages = await Promise.all(
      (list.data.messages ?? []).map(async (m) => {
        const msg = await client.gmail.users.messages.get({
          userId: "me",
          id: m.id as string,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "Date"],
        });
        const headers = msg.data.payload?.headers ?? [];
        const get = (name: string) => headers.find((h) => h.name === name)?.value ?? "";
        return {
          id: m.id,
          subject: get("Subject"),
          from: get("From"),
          date: get("Date"),
          snippet: msg.data.snippet,
        };
      }),
    );

    return NextResponse.json({ email: client.email, messages });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}
