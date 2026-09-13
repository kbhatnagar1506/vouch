-- Persona (withpersona.com) identity verification.
--
-- `users.id` is TEXT everywhere in this shared DB (see the portal branch's
-- CLAUDE.md for why), so it's referenced the same way here.
--
-- DATA MINIMIZATION IS THE POINT OF THIS SCHEMA. Persona's government-ID
-- verification returns far more than what's below — full birthdate,
-- document number, issue/expiry dates, nationality, sex, and photograph
-- URLs. None of that is stored here. We keep only:
--   * what Stripe Issuing actually requires to create a cardholder
--     (legal name + address — see card-issuing's lib/stripe-mint.ts), and
--   * derived booleans for everything else.
-- Most importantly `is_over_18` instead of the birthdate: the age check is
-- the only thing we need the DOB *for*, so we do the comparison once, keep
-- the answer, and discard the input. Persona remains the system of record;
-- `inquiry_id` is the pointer back to the full record if it's ever needed
-- for a dispute. A breach of this table leaks no document numbers, no
-- dates of birth, and no ID images.

create table if not exists identity_verifications (
  user_id text primary key references users(id) on delete cascade,
  -- Persona inquiry (inq_...). Unique: one live inquiry per user — a
  -- re-verification replaces the row rather than accumulating rows, and the
  -- event log below keeps the history.
  inquiry_id text not null unique,
  -- Persona account (act_...) — groups a person's inquiries across
  -- re-verifications. This is what makes account recovery possible later.
  account_id text,
  -- Persona's inquiry status verbatim (created/pending/completed/failed/
  -- expired/approved/declined/needs_review). Stored raw rather than mapped
  -- to our own enum so a new Persona status can't silently read as a
  -- terminal one. NOTE: only `approved` means verified — `completed` just
  -- means the user reached the final screen. See lib/persona-schema.ts.
  status text not null,

  -- Verified identity, for Stripe Issuing cardholder creation.
  name_first text,
  name_last text,
  address_street_1 text,
  address_street_2 text,
  address_city text,
  address_subdivision text,
  address_postal_code text,
  address_country_code text,

  -- Derived, never the raw inputs.
  is_over_18 boolean,
  phone_verified boolean not null default false,
  selfie_liveness_passed boolean,
  -- Persona's selfie<->government-ID face match metric. Kept as evidence
  -- for the voice binding below: it records how strongly the face on the
  -- ID matched the live selfie at the moment identity was established.
  selfie_document_similarity double precision,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every webhook Persona sends, logged verbatim before it's acted on. Same
-- pattern (and same reasoning) as the calling-agent branch's
-- `calling_agent_events`: when a third-party integration misbehaves, the
-- raw payload is the only thing that settles what actually happened.
create table if not exists identity_verification_events (
  id bigserial primary key,
  inquiry_id text,
  event_name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists identity_verification_events_inquiry_idx
  on identity_verification_events (inquiry_id, created_at desc);

-- The voice binding: ties a voice enrollment (owned by the
-- voice-verification branch) to the Persona inquiry that proved who the
-- enroller actually is. Without this, `voice_enrollments` proves only that
-- the voice on a call matches the voice that enrolled — it says nothing
-- about whose voice that is. With it, every later speaker-match inherits a
-- government-ID check, which is what lets the calling agent treat a phone
-- confirmation as authorization to spend.
--
-- Nullable and added here rather than in voice-verification's own
-- migration: enrollment happens earlier in onboarding than verification
-- (see docs/IDENTITY.md), so the column is populated after the fact.
alter table voice_enrollments
  add column if not exists persona_inquiry_id text;
