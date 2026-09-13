-- Populated from Stripe's issuing_transaction.created webhook (see
-- app/api/stripe/webhook/route.ts) -- a local read model of spend per
-- card, so the UI doesn't need a live Stripe API call just to show
-- transaction history.
create table if not exists card_transactions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references issued_cards(id) on delete cascade,
  stripe_transaction_id text not null unique,
  amount_cents integer not null,
  merchant_name text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists card_transactions_card_id_idx on card_transactions (card_id, occurred_at desc);
