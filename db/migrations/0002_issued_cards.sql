-- Virtual cards issued via Stripe Issuing (test/sandbox mode). No PAN/CVC
-- ever lands in this table or anywhere on our server — those are revealed
-- client-side only, via a short-lived Stripe ephemeral key + Stripe.js
-- Issuing Elements (see docs/CARDS.md "PCI scope"). This table only ever
-- stores what Stripe's own card object already treats as non-sensitive
-- (last4, brand, expiry, status).
create table if not exists issued_cards (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  stripe_card_id text not null unique,
  -- User-facing nickname, e.g. "Netflix" -- freeform, not tied by a hard
  -- foreign key to any other service's tables (gmail-connector's
  -- gmail_messages included), since this branch's own migrations must
  -- stay applicable to a fresh database on their own.
  label text not null default '',
  merchant text,
  last4 text not null,
  brand text not null,
  exp_month smallint not null,
  exp_year smallint not null,
  status text not null default 'active' check (status in ('active', 'inactive', 'canceled')),
  spending_limit_cents integer,
  -- Default true: one disposable card per transaction is the standard
  -- issuance model here, not the exception. The webhook handler
  -- (app/api/stripe/webhook/route.ts) auto-cancels a single-use card the
  -- moment its first transaction posts, so a merchant can never charge it
  -- again -- kills a subscription by construction, no manual cancel step.
  single_use boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists issued_cards_user_id_idx on issued_cards (user_id);
