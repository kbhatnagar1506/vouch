-- Maps each Vouch user to a Stripe Issuing Cardholder, since Stripe scopes
-- card issuance per-cardholder. Created lazily on first card request, one
-- per user, same pattern as gmail-connector's backboard_assistants.
create table if not exists stripe_cardholders (
  user_id text primary key references users(id) on delete cascade,
  stripe_cardholder_id text not null unique,
  created_at timestamptz not null default now()
);
