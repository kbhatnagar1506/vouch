import type { AccountBase, RemovedTransaction, Transaction } from "plaid";
import { pool } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getPlaidClient } from "@/lib/plaid";

async function upsertAccounts(itemId: string, accounts: AccountBase[]) {
  for (const account of accounts) {
    await pool.query(
      `insert into plaid_accounts
         (item_id, account_id, name, official_name, mask, type, subtype,
          current_balance, available_balance, iso_currency_code, raw, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       on conflict (account_id) do update set
         name = excluded.name,
         official_name = excluded.official_name,
         mask = excluded.mask,
         type = excluded.type,
         subtype = excluded.subtype,
         current_balance = excluded.current_balance,
         available_balance = excluded.available_balance,
         iso_currency_code = excluded.iso_currency_code,
         raw = excluded.raw,
         updated_at = now()`,
      [
        itemId,
        account.account_id,
        account.name,
        account.official_name,
        account.mask,
        account.type,
        account.subtype,
        account.balances.current,
        account.balances.available,
        account.balances.iso_currency_code,
        JSON.stringify(account),
      ],
    );
  }
}

async function upsertTransactions(transactions: Transaction[]) {
  for (const txn of transactions) {
    await pool.query(
      `insert into plaid_transactions
         (account_id, transaction_id, amount, iso_currency_code, date, authorized_date,
          name, merchant_name, category, payment_channel, pending, raw, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
       on conflict (transaction_id) do update set
         amount = excluded.amount,
         iso_currency_code = excluded.iso_currency_code,
         date = excluded.date,
         authorized_date = excluded.authorized_date,
         name = excluded.name,
         merchant_name = excluded.merchant_name,
         category = excluded.category,
         payment_channel = excluded.payment_channel,
         pending = excluded.pending,
         raw = excluded.raw,
         updated_at = now()`,
      [
        txn.account_id,
        txn.transaction_id,
        txn.amount,
        txn.iso_currency_code,
        txn.date,
        txn.authorized_date,
        txn.name,
        txn.merchant_name,
        JSON.stringify(txn.category ?? txn.personal_finance_category ?? null),
        txn.payment_channel,
        txn.pending,
        JSON.stringify(txn),
      ],
    );
  }
}

async function markRemoved(removed: RemovedTransaction[]) {
  for (const txn of removed) {
    if (!txn.transaction_id) continue;
    await pool.query(
      `update plaid_transactions set removed = true, updated_at = now() where transaction_id = $1`,
      [txn.transaction_id],
    );
  }
}

/**
 * Pulls all pending changes for one Plaid Item via /transactions/sync, upserting
 * accounts and transactions and advancing the stored cursor. Safe to call
 * repeatedly (e.g. from a webhook or a manual "sync now" action) — it's a no-op
 * if there's nothing new since the last cursor.
 */
export async function syncItemTransactions(itemId: string): Promise<{
  added: number;
  modified: number;
  removed: number;
}> {
  const { rows } = await pool.query<{ access_token_encrypted: string; transactions_cursor: string | null }>(
    `select access_token_encrypted, transactions_cursor from plaid_items where item_id = $1`,
    [itemId],
  );
  const item = rows[0];
  if (!item) throw new Error(`No plaid_items row for item_id ${itemId}`);

  const accessToken = decryptSecret(item.access_token_encrypted);
  let cursor = item.transactions_cursor ?? undefined;

  let added = 0;
  let modified = 0;
  let removed = 0;
  let hasMore = true;

  const plaidClient = getPlaidClient();

  try {
    while (hasMore) {
      const { data } = await plaidClient.transactionsSync({
        access_token: accessToken,
        cursor,
        options: { include_personal_finance_category: true },
      });

      if (data.accounts.length > 0) {
        await upsertAccounts(itemId, data.accounts);
      }
      if (data.added.length > 0) {
        await upsertTransactions(data.added);
        added += data.added.length;
      }
      if (data.modified.length > 0) {
        await upsertTransactions(data.modified);
        modified += data.modified.length;
      }
      if (data.removed.length > 0) {
        await markRemoved(data.removed);
        removed += data.removed.length;
      }

      cursor = data.next_cursor;
      hasMore = data.has_more;
    }

    await pool.query(
      `update plaid_items set transactions_cursor = $1, updated_at = now() where item_id = $2`,
      [cursor, itemId],
    );
    await pool.query(
      `insert into plaid_sync_runs (item_id, added_count, modified_count, removed_count, cursor_after)
       values ($1, $2, $3, $4, $5)`,
      [itemId, added, modified, removed, cursor],
    );

    return { added, modified, removed };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `insert into plaid_sync_runs (item_id, error) values ($1, $2)`,
      [itemId, message],
    );
    throw error;
  }
}
