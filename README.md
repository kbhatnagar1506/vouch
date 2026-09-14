# gmail-connector — receipts in, structured spending memory out

`gmail.getvouch.club` · [full docs](docs/GMAIL.md)

Reads a user's receipt and renewal emails and turns them into the thing every
other service reads from: classified, embedded, searchable spending memory.

**156 tests across 18 files** — the most heavily tested branch here, because
everything downstream trusts what this produces.

## The problem this branch actually solves

Nobody can tell you what they're subscribed to. The information exists, but it's
scattered across hundreds of receipt emails nobody reads, in a hundred different
formats, with the amount buried in an HTML table.

The dashboard's subscription list, the calling agent's "this month you paid…",
and the renew/hold/ask decision all come from here. Get this wrong and every
number a user sees downstream is wrong too.

## Work worth reading

**Two memory systems, written concurrently.** Each message lands in local
pgvector tables *and* the user's Backboard assistant. Classification has to run
first because everything downstream keys off its `categoryKey`, but the two
memory writes are independent — so they're a `Promise.all`, not sequential
awaits. The dependency that's real is respected; the one that isn't is removed.

**Chunking is content-aware.** `lib/chunking.ts` splits on structure rather than
a fixed character count, because a receipt cut mid-table produces an embedding
of nothing useful. Chunks carry their position so a retrieved fragment can be
traced to its source message.

**Backboard writes are deduped by design.** `gmail_messages.backboard_memory_id`
records what was already pushed, so a re-sync doesn't duplicate a user's memory.
Sync is idempotent — safe to re-run after a partial failure, which matters
because Gmail's API will rate-limit you mid-run.

**Category classification is embedding similarity, not an LLM call.** The
category and its similarity score are both stored, so a downstream decision can
say *why* it classified something, and a bad classification is debuggable
instead of being a black box that answered differently last Tuesday.

## Two undocumented vendor bugs, found by bisection

Both are in `lib/backboard.ts`, both with the workaround and the evidence in the
comment so nobody "simplifies" them away.

**Backboard 500s on any non-integer float in `metadata`.** `0.528` fails,
integers are fine, `1.0` is fine because JSON serialises it as `1`. Confirmed by
bisection. `sanitizeMetadata` stringifies offending values, which sidesteps it
without losing precision or silently dropping the field.

**Content is capped at 4096 UTF-8 *bytes*, not characters.** Undocumented, not
validated client-side, and easy to miss by capping on `.length` — which counts
UTF-16 code units, so one smart quote or arrow in an email body throws the count
off by exactly enough to trip it. `capContentLength` truncates on the byte
boundary, then strips the `U+FFFD` that appears when the cut lands mid-character
before appending the ellipsis, so the result is valid UTF-8 the whole way
through.

A third, smaller one: Backboard's `POST /memories` returns `{memory_id}` while
every other endpoint returns `{id}`. Mapping the POST response through the
shared parser produced `undefined` ids on requests that had genuinely succeeded.

## Tests

156 across 18 files, covering the pure logic that everything else rests on:
body extraction from multipart MIME, Gmail query construction, chunking
boundaries, embedding shape, category assignment, the memory store's tenant
isolation, fusion and search ranking, and the Backboard client including both
bugs above.

## Stack

Next.js 15 · TypeScript · PostgreSQL + pgvector · Gmail API (`googleapis`) ·
Backboard · Vitest

See [`docs/GMAIL.md`](docs/GMAIL.md) for the OAuth setup, the sync pipeline, the
memory schema, and the cron job.
