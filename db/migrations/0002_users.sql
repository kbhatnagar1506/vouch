-- Real user accounts, replacing the hardcoded "demo-user" placeholder used
-- while bank-connection was single-tenant.

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  email text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Preserve any data already written under the single-tenant placeholder
-- (e.g. a bank account connected before auth existed) so the foreign key
-- below doesn't orphan it. Its password_hash is a random value nobody
-- knows — this account can't be logged into; it exists only so existing
-- plaid_items rows stay valid. Reassign real ownership afterward with:
--   update plaid_items set user_id = '<real user id>' where user_id = 'demo-user';
insert into users (id, email, password_hash)
values ('demo-user', 'demo-user@placeholder.invalid', encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

alter table plaid_items
  add constraint plaid_items_user_id_fkey foreign key (user_id) references users (id) on delete cascade;
