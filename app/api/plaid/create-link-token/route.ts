import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { getPlaidClient } from "@/lib/plaid";

// TODO: replace with the real authenticated user id once auth is wired in.
// Every Plaid Item is scoped to this id (see plaid_items.user_id), so
// swapping this out is the only change needed to go multi-user.
const DEMO_USER_ID = "demo-user";

export async function POST() {
  try {
    const { data } = await getPlaidClient().linkTokenCreate({
      user: { client_user_id: DEMO_USER_ID },
      client_name: "Vouch",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: process.env.PLAID_WEBHOOK_URL,
      redirect_uri: process.env.PLAID_REDIRECT_URI,
    });
    return NextResponse.json({ link_token: data.link_token });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create link token" },
      { status: 500 },
    );
  }
}
