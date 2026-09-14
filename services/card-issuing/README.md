# card-issuing — disposable cards, and an MCP server that hands them to agents

`cards.getvouch.club` · [full docs](docs/CARDS.md)

Issues a single-use Stripe Issuing virtual card per payment. The card cancels
itself the instant its first transaction posts, so the merchant's next charge
is declined at the network before it reaches a retention flow.

The same lifecycle is exposed over **MCP**, so Claude or any MCP-speaking agent
can mint, freeze and cancel cards on a user's behalf under limits the user sets.

## The problem this branch actually solves

Handing an agent your card hands it every merchant, every amount, forever.
There is no expiry, no scope, no budget — just sixteen digits and trust.

A card that dies after one transaction inverts that. The agent gets spending
power bounded in advance and destroyed on use, so the blast radius of a
compromised or confused agent is one capped purchase rather than your account.

## Work worth reading

**The auto-cancel is a webhook, not a timer.** `recordCardTransaction` in
`lib/stripe.ts` fires on `issuing_transaction.created` and cancels the card in
the same handler that records the transaction. There's no polling and no
scheduled job to miss: the cancel is causally tied to the charge. The insert is
guarded by `on conflict (stripe_transaction_id) do nothing`, so Stripe's webhook
retries can't double-cancel or double-record.

**Agents never see a card number.** Every one of the eight MCP tools returns
only what Stripe itself treats as non-sensitive: last4, brand, expiry, status.
The PAN never enters this server. Revealing it is a client-side flow using a
short-lived ephemeral key scoped to one card
(`createCardEphemeralKey`), which is why `STRIPE_API_VERSION` is pinned as a
literal — the ephemeral key's version has to match what Stripe.js expects, and
the SDK exposes no runtime constant to read it back from.

**`simulate_purchase` doesn't decide anything.** It drives a real test-mode
authorization against the card's own `spending_controls` and lets *Stripe*
approve or decline. Application code that decided the outcome would be testing
itself; this tests the actual rule that will run in production.

**MCP auth is its own mechanism, deliberately.** MCP clients aren't browsers and
can't carry the `vouch_session` cookie every other route here relies on, so this
endpoint sits outside the cookie middleware and authenticates with revocable
bearer keys. Only the SHA-256 hash is stored — the raw token is shown exactly
once at creation, the same treatment GitHub and Stripe give their own keys. A
fresh `McpServer` is built per request with the user captured in closures, so
one user's tools can never address another's cards.

**Mock mode keeps the system testable when the vendor isn't.** This account's
Issuing Financial Account is stuck `pending` and Stripe refuses to create any
card against it, which would make everything downstream untestable.
`CARD_ISSUING_MODE=mock` swaps in `lib/card-mock.ts`, and the seam was chosen so
that only the four functions that actually call Stripe branch. Mock cards are
ordinary `issued_cards` rows tagged `ic_mock_`, so list, freeze, cancel, the
dashboard and the transactions table needed no changes at all, and a mock and a
real card coexist routed by their own ids.

## Two failures worth documenting

**`financial_account` → `financial_account_v2`.** Card creation fails without a
financial account id, and the SDK's types still expect the old parameter name
while this account requires the new one. It needs a cast, and the comment at the
call site says why so nobody "cleans it up".

**The whole UI was written in Tailwind on a branch with no Tailwind.** No
dependency, no PostCSS config, no import. Every class was inert and the pages
rendered as raw HTML for most of the build, unnoticed because this service was
always tested through its API.

## MCP

```sh
claude mcp add --transport http vouch-cards \
  https://cards.getvouch.club/api/mcp \
  --header "Authorization: Bearer mcpk_..."
```

Mint a key from the **Agent access** panel on `/cards`.

`create_temporary_card` · `list_cards` · `freeze_card` · `unfreeze_card` ·
`cancel_card` · `simulate_purchase` · `create_checkout` · `void_checkout`

The last two exist so the loop can be demonstrated end to end: they create a
Stripe Checkout page a minted card can actually be charged on. Every session is
**manual-capture and there is no capture tool anywhere in this codebase** — the
card is authorized over the real network, which is what makes the issuing
webhook fire, but money is never taken and voiding releases the hold at once.

## Stack

Next.js 15 · TypeScript · PostgreSQL · Stripe Issuing · Model Context Protocol
(`@modelcontextprotocol/sdk`, Streamable HTTP) · zod

See [`docs/CARDS.md`](docs/CARDS.md) for setup, the data model, PCI-scope
reasoning, and the mock-mode contract.
