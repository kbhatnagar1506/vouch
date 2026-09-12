import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";
import { getPlaidClient } from "@/lib/plaid";
import { requireUser, UnauthorizedError } from "@/lib/session";

export async function POST() {
  try {
    const user = await requireUser();
    const { data } = await getPlaidClient().linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: "Vouch",
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: "en",
      webhook: process.env.PLAID_WEBHOOK_URL,
      redirect_uri: process.env.PLAID_REDIRECT_URI,
    });
    return NextResponse.json({ link_token: data.link_token });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create link token" },
      { status: 500 },
    );
  }
}
