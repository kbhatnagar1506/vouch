-- Ported verbatim from aaditisinghal/vouch-aaditi migrations/006_create_spending_categories.sql.
-- No user_id column (categories are global, not per-user), nothing to adapt.

CREATE TABLE IF NOT EXISTS spending_categories (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  prototype_embedding VECTOR(768),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO spending_categories (key, label, description) VALUES
  (
    'active_subscription_usage',
    'Subscriptions actively in use',
    'Order confirmation or usage receipt for an on-demand recurring service such as a DoorDash food delivery order, an Uber or Lyft ride receipt, an Instacart grocery delivery, or similar pay-per-use activity on a service the user is already subscribed to or regularly uses.'
  ),
  (
    'subscription_signup_renewal',
    'Subscription purchases, sign-ups, and renewals',
    'Billing, renewal, sign-up, upgrade, or cancellation confirmation for a recurring subscription or membership, such as Netflix, Spotify, a gym membership, a SaaS product renewal, or an annual/monthly plan charge.'
  ),
  (
    'general_spending_habit',
    'General spending habit monitoring',
    'Any other purchase, payment, invoice, order confirmation, or bill that reflects general spending behavior but is not itself a subscription renewal or an on-demand subscription usage receipt, such as a one-off retail purchase, utility bill, or online order.'
  )
ON CONFLICT (key) DO NOTHING;
