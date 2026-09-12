import { NextResponse } from "next/server";
import { CountryCode } from "plaid";
import { pool } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getPlaidClient } from "@/lib/plaid";
import { syncItemTransactions } from "@/lib/plaid-sync";
import { requireUser, UnauthorizedError } from "@/lib/session";

export async function POST(request: Request) {
  let body: { public_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { public_token } = body;
  if (!public_token) {
    return NextResponse.json({ error: "public_token is required" }, { status: 400 });
  }

  try {
    const user = await requireUser();
    const plaidClient = getPlaidClient();
    const exchange = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token: accessToken, item_id: itemId } = exchange.data;

    const itemInfo = await plaidClient.itemGet({ access_token: accessToken });
    const institution = itemInfo.data.item.institution_id
      ? await plaidClient.institutionsGetById({
          institution_id: itemInfo.data.item.institution_id,
          country_codes: [CountryCode.Us],
        })
      : null;

    await pool.query(
      `insert into plaid_items
         (user_id, item_id, access_token_encrypted, institution_id, institution_name, raw, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (item_id) do update set
         access_token_encrypted = excluded.access_token_encrypted,
         institution_id = excluded.institution_id,
         institution_name = excluded.institution_name,
         raw = excluded.raw,
         updated_at = now()`,
      [
        user.id,
        itemId,
        encryptSecret(accessToken),
        itemInfo.data.item.institution_id,
        institution?.data.institution.name ?? null,
        JSON.stringify(itemInfo.data.item),
      ],
    );

    const result = await syncItemTransactions(itemId);

    return NextResponse.json({ ok: true, item_id: itemId, initial_sync: result });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to exchange token" },
      { status: 500 },
    );
  }
}
