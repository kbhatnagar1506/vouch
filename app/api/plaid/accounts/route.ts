import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// TODO: scope by the real authenticated user id once auth is wired in.
const DEMO_USER_ID = "demo-user";

export async function GET() {
  try {
    const { rows } = await pool.query(
      `select
         a.account_id,
         a.name,
         a.mask,
         a.type,
         a.subtype,
         a.current_balance,
         a.available_balance,
         a.iso_currency_code,
         i.institution_name,
         i.status as item_status,
         (select count(*) from plaid_transactions t
            where t.account_id = a.account_id and not t.removed) as transaction_count
       from plaid_accounts a
       join plaid_items i on i.item_id = a.item_id
       where i.user_id = $1
       order by a.created_at desc`,
      [DEMO_USER_ID],
    );
    return NextResponse.json({ accounts: rows });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load accounts" },
      { status: 500 },
    );
  }
}
