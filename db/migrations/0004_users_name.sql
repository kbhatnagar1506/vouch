-- lib/auth.ts's getUserById() selects `name` from `users`, but no
-- migration anywhere in this repo ever added that column -- bank-connection's
-- 0002_users.sql (where `users` is created) only has id/email/password_hash/
-- created_at. That means getUserById() -- called on every authenticated
-- request via lib/session.ts -- would fail with "column users.name does not
-- exist" the moment it actually ran. Caught while wiring the dashboard
-- branch's own copy of this same query against real user data.
alter table users add column if not exists name text not null default '';
