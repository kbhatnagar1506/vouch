# dashboard — the product surface, with nothing invented

`dashboard.getvouch.club` · [full docs](docs/DASHBOARD.md)

Two routes doing deliberately different jobs:

- **`/dashboard`** — real data. Subscriptions derived from classified Gmail,
  real issued cards, real Plaid balances, rule-based decisions.
- **`/demo`** — public, no login, seeded data from the original
  [vouch-ui](https://github.com/kbhatnagar1506/vouch-ui) HackRice build.

[**Try the demo**](https://dashboard.getvouch.club/demo) — no account needed.

## The rule this branch is built on

**The real dashboard never fabricates a number.**

Nothing in this stack measures how many hours you watched Netflix or how many
Spotify plays you racked up. The seeded demo shows those fields because vouch-ui
invented them for a hackathon mock. So on the real dashboard those fields are
**left empty**, not filled with a plausible-looking estimate.

That's enforced in the type system rather than by discipline:
`usage30`, `usageUnit`, `trend` and `worth` are *optional* on `Subscription`,
and `docs/DASHBOARD.md` carries a field-by-field real-vs-stubbed mapping.

It cost a better-looking screenshot. It's the right call, because a dashboard
that invents one number can't be trusted about any of them.

## Work worth reading

**The renew / hold / ask decision is rule-based, not an LLM call.** Price change
versus the last charge, days until renewal, whether an active card exists, how
many times this merchant has charged before. Deliberate: the reason shown to the
user is *the reason used*, every time, and it doesn't answer differently on a
re-run. An LLM here would be a worse product and an unfalsifiable one.

**Every figure traces to a table.** `lib/dashboard-data.ts` is one file where
each number's provenance is visible. Two examples where the honest answer was
harder than the flattering one:

- *"Saved"* is the price of subscriptions with no currently-active card —
  a real, current-state figure. Prior months show `0` because no decision was
  recorded then, rather than a back-filled guess.
- The budget's *"cap"* is **last month's actual spend**, not an invented target,
  so "vs. cap" compares two real numbers.

**Optional tables degrade instead of breaking the page.** The MCP-keys and
identity lookups live in migrations other branches own and may not exist on a
given database. They're separate queries each wrapped in its own `try/catch`
rather than folded into the connectors `UNION` — one missing table would
otherwise fail that whole query and take the entire dashboard down instead of
hiding a single row.

**Backboard memories are shown raw.** Each subscription's popup lists the top-k
memories behind it, verbatim, in Backboard's own relevance order. No model
summarises them, nothing is re-ranked or filtered by score. The one
transformation is flattening metadata values to strings so JSX can render them —
which is exactly why that logic lives in a pure module with 20 tests.

Notably it *preserves* a float that gmail-connector stored as a string to dodge
a Backboard 500: `"0.8271"` stays a string, because the string is the stored
value and re-parsing it would silently change its type on the way to the UI.

**Cross-service calls forward the session server-side.** The "Call me" button
doesn't talk to Vapi — it forwards to the calling-agent service, re-sending the
user's own session cookie on a server-to-server request. Both branches verify
the same `JWT_SECRET`, so this needs no CORS and no second auth system.

## Tests

20, on `lib/memory-schema.ts` — pure, so they run with no database and no
Backboard account. Malformed rows are skipped without discarding good ones, a
missing score becomes `null` rather than a guess, and timestamps format in UTC
so server and client renders can't disagree.

## Stack

Next.js 15 (App Router) · TypeScript · PostgreSQL · Recharts · lucide-react ·
Stripe · Vitest

UI ported from `kbhatnagar1506/vouch-ui`, a HackRice 16 build, with the mock
data quarantined to `/demo`.

See [`docs/DASHBOARD.md`](docs/DASHBOARD.md) for the real-vs-stubbed mapping and
every field's data source.
