-- Free-text detail specific to one call (e.g. the actual transaction being
-- verified for a purchase_verification call) — see
-- lib/calling-agent/assistant.ts's CallOverridesOptions.context.
alter table calling_agent_calls add column if not exists context text;
