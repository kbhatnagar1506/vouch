# Portal — `login.getvouch.club`

| | |
|---|---|
| **Branch** | `portal` (ref: `origin/portal`) |
| **Subdomain** | `login.getvouch.club` *(per task brief — conflicts with this branch's own CLAUDE.md; see [Known Gaps §10.3](#103-subdomain-conflicting-claims))* |
| **Role** | Sign-up / login. The only issuer of sessions. |
| **Verified against** | `origin/portal` @ commit `5c00426` ("Point post-auth redirect to the new Gmail connector step") |
| **Doc last generated** | 2026-09-13 |

> **Two things flagged by design, confirmed true on inspection:**
> 1. **Structural inconsistency** — this branch is laid out as `src/app` + `src/lib` + `src/components`. Every sibling branch checked (`bank-connection`, `gmail-connector`, `claude/vigilant-meitner-fxqi9c`, and others) uses bare `app/` + `lib/` at the repo root instead. Root cause and details in [§2](#2-file--directory-structure) and [§10.1](#101-structural-inconsistency-src-layout).
> 2. **Migration numbering gap** — `migrations/` contains `001_create_users.sql` and `003_create_user_profiles.sql`. `002` does not exist and never has — confirmed absent from this branch, every sibling branch, and full git history. Details in [§5](#5-database-schema) and [§10.2](#102-migration-numbering-gap-002-never-existed).

---

## 1. Purpose & Role

Portal is the entry point of the Vouch onboarding chain — the first thing any user hits, at the apex/`login` subdomain. Per the repo-wide convention (root `CLAUDE.md`), each onboarding step (Gmail, voice agents, bank connection, temporary card generator, …) is its own service branch/subdomain sharing one Postgres DB and one session cookie. Portal's own `CLAUDE.md` states its role explicitly:

> "This branch is the portal: login/signup, session issuance, and the onboarding form. It's the one service every other branch depends on for identity — sibling services (e.g. `bank-connection`) don't have their own login UI, they just verify a session this branch issued."

Concretely, portal is the **only** branch in the repo that:
- Collects and hashes passwords (`bcryptjs`),
- Mints the `vouch_session` JWT (`jsonwebtoken`),
- Owns the `users` table's write path (`INSERT`/credential `SELECT`).

Every other service branch (`bank-connection` confirmed directly — see [§4](#4-session-issuance-mechanics)) only **verifies** the cookie portal issued, via the lighter, edge-compatible `jose` library, and redirects back to portal's login page when no valid session is present.

Portal was not built from scratch in this repo — commit `780f9c7` ("Add portal branch: login, signup, onboarding, session issuance") brought in a pre-existing external app (`aaditisinghal/vouch-aaditi`) wholesale, rewiring it to this repo's shared DB/session contract. That origin explains the structural inconsistency noted above (see [§10.1](#101-structural-inconsistency-src-layout)).

---

## 2. File & Directory Structure

```
.env.example
.gitignore
CLAUDE.md
eslint.config.mjs
next.config.ts
package.json / package-lock.json
postcss.config.mjs
tsconfig.json
migrations/
  001_create_users.sql
  003_create_user_profiles.sql
public/
  logo1.png
  file.svg, globe.svg, next.svg, vercel.svg, window.svg
scripts/
  migrate.mjs
src/
  app/
    api/auth/{login,logout,me,signup}/route.ts
    globals.css
    icon.png
    layout.tsx
    login/page.tsx
    login-extend/page.tsx
    page.tsx
    signup/page.tsx
    signup-extend/page.tsx
  components/
    auth-form.tsx
    logout-button.tsx
  lib/
    auth.ts
    db.ts
```

| Path | Purpose |
|---|---|
| `.env.example` | Documents `DATABASE_URL`, `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`. Missing `GMAIL_CONNECTOR_URL` — see [§7](#7-environment-variables). |
| `.gitignore` | Standard Next.js ignore list + `.env*` (keeps `.env.example`) + `.vercel` + `.claude/settings.local.json`. |
| `CLAUDE.md` | Root generic content (Deployment, Service branches, Tiger CLI — word-for-word identical to the repo root `CLAUDE.md`) **plus** a portal-specific "Portal (auth + onboarding)" section, **plus** a trailing `<!-- BEGIN:nextjs-agent-rules -->` block. That last block is auto-generated/re-added by `next dev` itself (per its own inline comment) — not hand-authored guidance. See [§9](#9-packagejson--framework-notes) for why this branch calls out Next.js 16 specifically. |
| `eslint.config.mjs` | Flat ESLint config: `eslint-config-next`'s `core-web-vitals` + `typescript` rule sets, via `defineConfig`. |
| `next.config.ts` | Empty `NextConfig` — no custom config. |
| `postcss.config.mjs` | Registers `@tailwindcss/postcss` only (Tailwind v4 CSS-first setup, no `tailwind.config.ts`). |
| `tsconfig.json` | Standard Next.js strict TS config; `paths: {"@/*": ["./src/*"]}` — confirms the `src/` layout is deliberate, not accidental. |
| `package.json` | See [§9](#9-packagejson--framework-notes). |
| `migrations/001_create_users.sql` | Creates `users`. See [§5](#5-database-schema). |
| `migrations/003_create_user_profiles.sql` | Creates `user_profiles`. See [§5](#5-database-schema). |
| `scripts/migrate.mjs` | Minimal migration runner: applies `migrations/*.sql` in filename order inside a transaction each, tracks applied filenames in a shared `_migrations` table (shared across all service branches touching the same DB — collision-safe because it tracks by filename string, and each branch's migrations live in differently-named files). Run via `npm run db:migrate`. |
| `public/logo1.png` | Vouch wordmark logo (current: 82,090 bytes) — the only `public/` image actually referenced in code (`auth-form.tsx`, `signup-extend/page.tsx`). Went through several revisions (see commit history in [§9](#9-packagejson--framework-notes)/git log: bigger, centered, de-duplicated text). |
| `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Default `create-next-app` boilerplate icons. **Confirmed unreferenced** by any code on this branch (repo-wide grep for each filename returns nothing) — leftover scaffold cruft. |
| `src/app/icon.png` (7,438 bytes) | Next.js App Router file-convention icon — auto-served as the favicon/app icon because of its reserved name/location; not manually referenced anywhere. |
| `src/app/layout.tsx` | Root layout: loads Geist Sans/Mono via `next/font/google`, sets `<title>Vouch</title>`, wraps children in a flex column body. |
| `src/app/page.tsx` (`/`) | Pure redirect gate — see [§6](#6-frontend-pages). |
| `src/app/globals.css` | Tailwind v4 import + theme tokens (`--background`/`--foreground`) + a `shake` keyframe used by the auth form's error banner. |
| `src/app/login/page.tsx`, `src/app/signup/page.tsx` | Thin wrappers rendering `<AuthForm initialMode="login"/"signup" />`. |
| `src/app/login-extend/page.tsx`, `src/app/signup-extend/page.tsx` | Post-auth gate + redirect to the next onboarding step. See [§6](#6-frontend-pages) and [§8](#8-post-auth-redirect-target). |
| `src/app/api/auth/{login,signup,logout,me}/route.ts` | The 4 API routes. See [§3](#3-api-routes). |
| `src/components/auth-form.tsx` | The shared login/signup form UI (client component). See [§6](#6-frontend-pages). |
| `src/components/logout-button.tsx` | Logout button (client component). **Exported but not imported/rendered anywhere on this branch** — see [§10.8](#108-orphaned-logoutbutton-component). |
| `src/lib/auth.ts` | Password hashing, JWT sign/verify, cookie options. Full breakdown in [§4](#4-session-issuance-mechanics). |
| `src/lib/db.ts` | Lazily-constructed shared `pg` `Pool`, exposed via a `Proxy` so `pool.query(...)` call sites don't change. |

---

## 3. API Routes

| Method | Path | Auth required | Success status | Error statuses |
|---|---|---|---|---|
| `POST` | `/api/auth/signup` | None (creates identity) | `201` | `400` ×3, `409` |
| `POST` | `/api/auth/login` | None (proves identity) | `200` | `400` ×2, `401` |
| `POST` | `/api/auth/logout` | None (idempotent clear) | `200` | — |
| `GET` | `/api/auth/me` | Optional — reads cookie if present | `200` (always) | — |

### `POST /api/auth/signup` — `src/app/api/auth/signup/route.ts`

Request body:
```ts
{ name?: string; email?: string; password?: string }
```

Validation, in order (first failure wins):
1. Body must parse as JSON (`req.json().catch(() => null)`) → **400** `{ "error": "Invalid request body" }`
2. `name` required, non-empty after `.trim()` → **400** `{ "error": "Name is required" }`
3. `email` required, must match `EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/` → **400** `{ "error": "A valid email is required" }`
4. `password` required, length ≥ 8 → **400** `{ "error": "Password must be at least 8 characters" }`
5. Email normalized via `.trim().toLowerCase()`; existing-account check (`SELECT id FROM users WHERE email = $1`) → **409** `{ "error": "An account with this email already exists" }`

On success: `bcrypt.hash(password, 12)`, `INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email`, sign a session JWT, and respond:
```ts
// 201
{ "user": { "id": string, "name": string, "email": string } }
```
`Set-Cookie: vouch_session=<jwt>` using `sessionCookieOptions(true)` — **signup always sets a persistent 30-day cookie**, regardless of any client input (there is no `rememberMe` concept on signup). No explicit try/catch around the DB calls — an unhandled DB error falls through to Next's default 500.

### `POST /api/auth/login` — `src/app/api/auth/login/route.ts`

Request body:
```ts
{ email?: string; password?: string; rememberMe?: boolean }
```

Validation:
1. Body parse → **400** `{ "error": "Invalid request body" }`
2. `email` and `password` both required, must be strings → **400** `{ "error": "Email and password are required" }` (no email-format re-validation on login, unlike signup)
3. Email normalized `.trim().toLowerCase()`; lookup `SELECT id, name, email, password_hash FROM users WHERE email = $1`
4. No matching row **or** `bcrypt.compare` fails → **both cases return the identical** **401** `{ "error": "Invalid email or password" }` via a shared `invalidCredentials()` closure — deliberately indistinguishable, to avoid leaking whether an email is registered.

On success:
```ts
// 200
{ "user": { "id": string, "name": string, "email": string } }
```
`Set-Cookie: vouch_session=<jwt>` using `sessionCookieOptions(Boolean(rememberMe))` — persistent 30-day cookie only if the client sent `rememberMe: true`; otherwise a non-persistent (browser-session) cookie. No explicit 500 handler.

### `POST /api/auth/logout` — `src/app/api/auth/logout/route.ts`

No request body, no auth check — callable whether or not a valid session exists. Clears the cookie by re-setting `vouch_session` to `""` with `{ ...sessionCookieOptions(false), maxAge: 0 }` (domain/path must match how it was originally set, or the browser won't recognize it as the same cookie — noted explicitly in the source comment). Always responds:
```ts
// 200
{ "ok": true }
```

### `GET /api/auth/me` — `src/app/api/auth/me/route.ts`

No auth required to call — this *is* the "am I logged in" check. Always returns **200**; auth state is communicated only via the `user` field:
- No cookie → `{ "user": null }`
- Cookie present but `verifySession` fails (expired/invalid/tampered) → `{ "user": null }`
- Valid session but the `users` row no longer exists (e.g. deleted account, stale token) → `{ "user": null }` (via `result.rows[0] ?? null`)
- Otherwise → `{ "user": { "id": string, "name": string, "email": string } }`

---

## 4. Session Issuance Mechanics

All of this lives in `src/lib/auth.ts`.

| Constant/behavior | Value |
|---|---|
| Cookie name | `vouch_session` (`SESSION_COOKIE_NAME`) |
| Algorithm | **HS256** — not passed explicitly to `jwt.sign`; this is `jsonwebtoken`'s default when the secret is a plain string. Confirmed explicitly by this branch's own `CLAUDE.md` ("HS256 JWT signed with `JWT_SECRET`"). |
| Claims (payload) | `{ userId: string, email: string }` exactly (type `SessionPayload`), plus `jsonwebtoken`'s auto-added `iat`/`exp`. No `sub`, `iss`, `aud`, or `nbf`. |
| Token expiry | `expiresIn: SESSION_MAX_AGE_SECONDS` = `60 * 60 * 24 * 30` = **2,592,000 s (30 days)**, unconditionally — every signed token expires in 30 days regardless of "remember me" (see below). |
| Signing secret | `process.env.JWT_SECRET`, read once at module scope. **If unset, the module throws immediately at import time** (`if (!JWT_SECRET) throw new Error(...)`) — see [§10.7](#107-jwt_secret-throws-eagerly-unlike-databaseurl). |

### Cookie flags — `sessionCookieOptions(rememberMe: boolean)`

| Flag | Value | Notes |
|---|---|---|
| `httpOnly` | `true` | Always. |
| `secure` | `process.env.NODE_ENV === "production"` | `false` in dev so it works over plain HTTP locally. |
| `sameSite` | `"lax"` | |
| `path` | `"/"` | |
| `domain` | `process.env.SESSION_COOKIE_DOMAIN` | e.g. `.getvouch.club` — this is what makes the cookie **readable by every sibling subdomain**. If unset, `domain` is `undefined` → browser defaults to a host-only cookie (documented local-dev fallback in `.env.example`). |
| `maxAge` | `SESSION_MAX_AGE_SECONDS` **only if `rememberMe` is `true`**; the key is omitted entirely otherwise | When omitted, the cookie is a non-persistent "session cookie" most browsers clear on browser close. |

**Subtlety worth flagging**: "remember me" only controls the *cookie's* persistence — never the JWT's own validity window, which is always 30 days from issuance. If a user unchecks "Remember me", the cookie is asked to disappear at browser-close, but the token inside (if it somehow survives, e.g. via a browser's "restore session" feature) would still `verify` successfully for up to 30 days.

### Functions

- `hashPassword(password)` → `bcrypt.hash(password, 12)` (cost factor 12; `bcryptjs`, pure-JS, no native bindings).
- `verifyPassword(password, hash)` → `bcrypt.compare(...)`.
- `signSession(payload)` → `jwt.sign(payload, JWT_SECRET, { expiresIn: SESSION_MAX_AGE_SECONDS })`. **Called only from `/api/auth/signup` and `/api/auth/login`** — the only two places in the entire repo (confirmed) that mint a `vouch_session` token.
- `verifySession(token)` → `jwt.verify(...)` wrapped in try/catch, returns `SessionPayload | null` (never throws to the caller). Used by every route/page here that trusts a session: `/api/auth/me`, `/`, `/login-extend`, `/signup-extend`.

### How this differs from every other branch

Portal is the **only** branch in the repo whose `package.json` lists `bcryptjs` or `jsonwebtoken` at all — checked `bank-connection`, `gmail-connector`, `calling-agent`, `card-issuing`, `dashboard`, `identity-verification`, `voice-verification`, and the production branch; none carry either dependency. Siblings verify the identical HS256 `vouch_session` cookie using **`jose`** instead (edge-runtime compatible, unlike `jsonwebtoken`) — e.g. `bank-connection`'s `middleware.ts` reads the cookie, calls its own `verifySessionToken()`, and on failure redirects to:
```ts
new URL(process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login")
```
— independent confirmation that portal is the sole minter of this cookie, and (see [§10.3](#103-subdomain-conflicting-claims)) independent corroboration of the `login.getvouch.club` subdomain. Every service that verifies these sessions must use the *same* `JWT_SECRET` value — stated explicitly in portal's `CLAUDE.md`.

---

## 5. Database Schema

### `migrations/001_create_users.sql` (verbatim)

```sql
-- id is TEXT (not UUID) to match bank-connection's earlier users table
-- (db/migrations/0002_users.sql on that branch), which already exists on
-- the shared production DB with a foreign key from plaid_items pointing
-- at it — changing the column type retroactively isn't safe (it holds a
-- non-UUID placeholder value, 'demo-user', for data connected before this
-- table existed). Functionally identical either way: the pg driver
-- returns both TEXT and UUID columns as plain JS strings.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reconciles with a users table that may already exist from that sibling
-- migration, which predates `name` and doesn't have it.
ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
```

### `migrations/003_create_user_profiles.sql` (verbatim)

```sql
-- user_id is TEXT to match users.id (see 001_create_users.sql).
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age INTEGER NOT NULL,
  phone_number TEXT NOT NULL,
  address_street TEXT NOT NULL,
  address_city TEXT NOT NULL,
  address_state TEXT NOT NULL,
  address_zip TEXT NOT NULL,
  employment_status TEXT NOT NULL,
  income_range TEXT NOT NULL,
  financial_goal TEXT NOT NULL,
  bank_connected BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `users` — column usage in code

| Column | Used where |
|---|---|
| `id` | JWT `userId` claim (signed on login/signup); `WHERE id = $1` in `/api/auth/me`, `login-extend`, `signup-extend`; returned in signup/login responses |
| `name` | Signup `INSERT` input (`name.trim()`); returned by login/signup/`me`; displayed on `signup-extend` ("Welcome, {name}") |
| `email` | Lookup key for login (`WHERE email = $1`) and signup uniqueness check; JWT `email` claim; returned to client; displayed on `signup-extend` |
| `password_hash` | Written by signup (`bcrypt.hash`), compared by login (`bcrypt.compare`) — **never** included in any API response |
| `created_at` | Set by the column default only. **Not read/selected anywhere in current code** — an earlier version of `login-extend` displayed a "Joined" date from this column; that whole card was deleted in commit `e1f1b2a` |

### `user_profiles` — **unreferenced by any code on this branch**

Confirmed via repo-wide `git grep` for `user_profiles`, `bank_connected`, `phone_number`, `financial_goal`, etc. — zero hits outside the migration file itself. Every column here (`age`, `phone_number`, `address_*`, `employment_status`, `income_range`, `financial_goal`) was originally populated by an onboarding form — `src/app/onboarding/page.tsx` + `src/components/onboarding-form.tsx` + `src/app/api/onboarding/route.ts` — added in the same initial commit as this migration (`780f9c7`) and deleted two commits later in `6e853e8` ("Remove onboarding — go straight from auth to bank-connection"). That commit's message explains why the table was kept anyway:

> "`user_profiles` (migrations/003) is left in place — bank-connection's best-effort `bank_connected` update still no-ops harmlessly without it, and it's cheap to resurrect an onboarding step later if needed."

`bank_connected` is never set to `true` by anything in this branch — portal's `CLAUDE.md` documents it as intended to be written from `bank-connection`'s `exchange-token` route (or a shared webhook), "not yet wired as of this branch."

---

## 6. Frontend Pages

| Route | Component | Behavior |
|---|---|---|
| `/` | `src/app/page.tsx` | Server component, renders nothing. Reads + verifies the `vouch_session` cookie; `redirect("/login-extend")` if valid, else `redirect("/login")`. |
| `/login` | `src/app/login/page.tsx` | Renders `<AuthForm initialMode="login" />`. |
| `/signup` | `src/app/signup/page.tsx` | Renders `<AuthForm initialMode="signup" />`. |
| `/login-extend` | `src/app/login-extend/page.tsx` | Post-**login** gate. See below. |
| `/signup-extend` | `src/app/signup-extend/page.tsx` | Post-**signup** gate + confirmation screen. See below. |

### `AuthForm` (`src/components/auth-form.tsx`)

Single client component that drives both `/login` and `/signup` — there's no full page navigation between the two modes; `switchMode()` updates local state and calls `window.history.replaceState(null, "", "/${next}")` to update the URL bar without a reload or remount, with a ~160 ms opacity cross-fade (`FADE_MS`).

UI: centered card, Vouch wordmark (`public/logo1.png`), an animated pill-style Log In/Sign Up toggle (sliding blue indicator via a `translate-x` transition), then the form itself:
- **Full name** field — signup only, `autoComplete="name"`, required.
- **Email** field — both modes, `type="email"`, required.
- **Password** field — both modes, `minLength={8}`, with a show/hide toggle (`EyeIcon`) and, on signup only, a live strength hint ("At least 8 characters" → "N more to go" → "Looks good", color-coded slate/red/emerald).
- **Remember me** checkbox — login only, defaults to checked (`true`).
- Inline error banner (`role="alert"`) with a CSS `shake` keyframe animation (defined in `globals.css`) on failure.
- Submit button shows a spinner + "Please wait…" while `loading`.

On submit: `POST`s JSON to `/api/auth/login` or `/api/auth/signup` depending on mode. On a non-OK response, shows `data.error` inline. On success, `router.push("/login-extend")` (login) or `router.push("/signup-extend")` (signup), then `router.refresh()`. A thrown/network-level error shows a generic "Network error — please try again".

### `/login-extend` vs `/signup-extend` — why two variants exist

Both pages perform the **identical guard sequence**: re-verify the session cookie (`redirect("/login")` if missing/invalid), re-check the referenced user still exists in `users` (`redirect("/login")` if not — handles a deleted-account-but-stale-cookie edge case), then send the user to `GMAIL_CONNECTOR_URL` (see [§8](#8-post-auth-redirect-target)). Where they differ is presentation:

- **`login-extend`** renders **nothing** on success — it's a pure server-side `redirect()`. A returning user's re-entry is treated as routine; there's no intermediate screen.
- **`signup-extend`** **renders a confirmation card** — "Account created — Welcome, {name}. Your account for {email} is ready. Let's get you set up." — with a "Continue" button (`<Link href={GMAIL_CONNECTOR_URL}>`) rather than redirecting immediately.

The split exists because the two events warrant different UX: login is unremarkable and should get out of the way, while signup is a one-time "it worked" moment where an instant, unannounced redirect off-domain (immediately after the user just filled out a form) would feel abrupt. Historically both pages did more — `login-extend` used to render a full "You're logged in" info card with name/email/joined-date, and both used to gate on a `user_profiles` row existing before allowing onboarding to continue (`redirect("/onboarding")` otherwise) — both of those behaviors were removed in commits `e1f1b2a` and `6e853e8` respectively, but the two separate routes were kept rather than merged into one.

### `LogoutButton` (`src/components/logout-button.tsx`)

Client component: `POST /api/auth/logout`, then `router.push("/login")` + `router.refresh()`. **Not imported or rendered anywhere on this branch** — see [§10.8](#108-orphaned-logoutbutton-component).

---

## 7. Environment Variables

| Variable | Read in | Purpose | Default / fallback | In `.env.example`? |
|---|---|---|---|---|
| `DATABASE_URL` | `src/lib/db.ts`, `scripts/migrate.mjs` | Tiger Cloud/Postgres connection string, shared across all service branches | None — `db.ts` throws when the pool is first constructed (lazily, on first query); `migrate.mjs` logs an error and `exit(1)` | Yes (placeholder connection string shown) |
| `JWT_SECRET` | `src/lib/auth.ts` | HS256 sign/verify key for `vouch_session`; must be identical across every service that verifies sessions | None — **throws eagerly at module import time** if unset (see [§10.7](#107-jwt_secret-throws-eagerly-unlike-databaseurl)) | Yes (blank; comment: "must be the SAME value across every service… `openssl rand -hex 32`") |
| `SESSION_COOKIE_DOMAIN` | `src/lib/auth.ts` (`sessionCookieOptions`) | Cookie `Domain` attribute so sibling subdomains can read the cookie | `undefined` → host-only cookie (documented as the intended local-dev behavior) | Yes (example value `.getvouch.club`) |
| `NODE_ENV` | `src/lib/auth.ts` (`sessionCookieOptions`) | Gates the cookie's `secure` flag (`true` only in production) | Managed by Next.js/Node automatically | Not applicable — framework-managed, correctly not listed |
| `GMAIL_CONNECTOR_URL` | `src/app/login-extend/page.tsx`, `src/app/signup-extend/page.tsx` (each declares its own copy of the constant — not shared from one module) | Where a freshly authenticated user is sent next; first step of the onboarding chain | Hardcoded fallback `"https://gmail.getvouch.club/connect"` if unset | **No — missing from `.env.example`** (gap; see [§10.6](#106-gmail_connector_url-missing-from-envexample)) |

`BANK_CONNECTION_URL` appeared briefly in git history (commit `e1f1b2a`, default `https://bankconnection.getvouch.club/bank`) but was fully replaced by `GMAIL_CONNECTOR_URL` in `5c00426` — it is **not** read by any code currently on this branch.

---

## 8. Post-Auth Redirect Target

**Current target**: `GMAIL_CONNECTOR_URL`, defaulting to `https://gmail.getvouch.club/connect` — read independently in both `login-extend/page.tsx` and `signup-extend/page.tsx`.

### How it got here (3 commits)

1. **`e1f1b2a`** — "Redirect to bank-connection after login". Introduced `BANK_CONNECTION_URL` (default `https://bankconnection.getvouch.club/bank`), replacing a static "You're logged in" info card with a redirect. At this point `login-extend` still checked for a `user_profiles` row and routed to `/onboarding` if one didn't exist.
2. **`6e853e8`** — "Remove onboarding — go straight from auth to bank-connection". Deleted the onboarding route/page/form outright (`src/app/api/onboarding/route.ts`, `src/app/onboarding/page.tsx`, `src/components/onboarding-form.tsx` — 473 lines removed); the `user_profiles` existence check was dropped from `login-extend`; both `-extend` pages now went straight to `BANK_CONNECTION_URL`.
3. **`5c00426`** (current `HEAD`) — "Point post-auth redirect to the new Gmail connector step". Replaced `BANK_CONNECTION_URL` with `GMAIL_CONNECTOR_URL`. Commit message states the full intended chain:
   > "Onboarding chain is now **signup/login → Gmail → bank → voice registration**. … both now go to `GMAIL_CONNECTOR_URL` first, which itself continues on to `BANK_CONNECTION_URL` once Gmail is connected (or skipped)."

   That forwarding logic (Gmail → bank) lives on the `gmail-connector` branch, not here — out of scope for this doc.

### Gap: `?next=` is never honored

Sibling `bank-connection`'s `middleware.ts` redirects unauthenticated users to portal with a return path attached:
```ts
const loginUrl = new URL(process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login");
loginUrl.searchParams.set("next", request.url);
return NextResponse.redirect(loginUrl);
```
Portal, however, **never reads any query/search parameter anywhere** — confirmed via a repo-wide `git grep` for `searchParams`/`useSearchParams` on this branch (zero matches). `/login`'s page, `AuthForm`, and both `-extend` pages always continue through the fixed `GMAIL_CONNECTOR_URL` chain regardless of how the user arrived. Practical effect: a logged-out user deep-linked into `bank-connection` gets bounced to login, authenticates successfully, and is sent to Gmail-connector — **not** back to bank-connection — losing their original destination.

---

## 9. `package.json` / Framework Notes

```json
{
  "dependencies": {
    "bcryptjs": "^3.0.3",
    "jsonwebtoken": "^9.0.3",
    "next": "16.3.5",
    "pg": "^8.23.0",
    "react": "19.2.8",
    "react-dom": "19.2.8"
  }
}
```

- **Next.js `16.3.5`** — every other branch checked (`bank-connection`, `gmail-connector`, `calling-agent`, `card-issuing`, `dashboard`, `identity-verification`, `voice-verification`, and the production branch `claude/vigilant-meitner-fxqi9c`) pins `next@15.5.25` / `react@19.1.1`. **Portal is the only branch on Next 16** (React `19.2.8` here vs `19.1.1` elsewhere) — flagged by the branch's own `CLAUDE.md`: "Next.js 16 (this branch only — other branches may be on different Next versions; that's fine, each branch's own `package.json` governs its own build)." This shows up concretely in code: `src/app/layout.tsx`'s `RootLayout` types its props as `LayoutProps<"/">`, a typed-route-props helper tied to Next 16's App Router typegen.
- **`bcryptjs` + `jsonwebtoken`** — unique to this branch; no sibling branch's `package.json` lists either (see [§4](#4-session-issuance-mechanics)). Matches the "only issuer of sessions" role — siblings verify with `jose` instead (e.g. `bank-connection` pins `jose@6.2.12`, no `jsonwebtoken`/`bcryptjs`).
- **`pg`** — same `Pool`-via-`lib/db.ts` pattern used repo-wide, consistent with the "one shared Tiger DB" convention.
- **Tailwind v4** (`tailwindcss@^4` + `@tailwindcss/postcss`, devDependencies) — CSS-first config, no `tailwind.config.ts`; `postcss.config.mjs` only registers the plugin, `globals.css` uses `@import "tailwindcss"` + `@theme inline`. Minor inconsistency: portal floats on `^4` while `bank-connection` pins an exact `4.3.3`.
- **`eslint-config-next@16.3.5`** matches the Next version; flat config (`eslint.config.mjs`) via `defineConfig`/`globalIgnores` — standard for Next 16.
- **Scripts**: `dev`, `build`, `start`, `lint` (bare `eslint`, no path args), and `db:migrate` → `node --env-file=.env scripts/migrate.mjs` — uses Node's native `--env-file` flag rather than a `dotenv` dependency.

---

## 10. Known Gaps, Discrepancies & Risks

### 10.1 Structural inconsistency: `src/` layout

Confirmed: portal uses `src/app/`, `src/lib/`, `src/components/`. Direct `git ls-tree` comparison shows `bank-connection`, `gmail-connector`, and the production branch (`claude/vigilant-meitner-fxqi9c`) all use bare `app/`, `lib/` (and `bank-connection`/`gmail-connector` also keep `components/` at the repo root, not under `src/`). `tsconfig.json`'s `paths: {"@/*": ["./src/*"]}` shows this is functional/deliberate, not a stray leftover.

**Root cause** (from commit `780f9c7`'s diff stat): the production branch's pre-portal scaffold *did* use bare `app/`/`lib/` (`app/api/health/route.ts`, `app/layout.tsx`, `app/page.tsx`, `lib/db.ts` — all present and then deleted in that same commit). The portal commit removed those files wholesale and replaced them with an already-built external app (`aaditisinghal/vouch-aaditi`) that happened to use the `src/` convention — including moving the pre-existing `lib/db.ts` to `src/lib/db.ts` — rather than porting the incoming code into the existing bare-root convention.

### 10.2 Migration numbering gap: `002` never existed

`migrations/` contains only `001_create_users.sql` and `003_create_user_profiles.sql`. Confirmed by direct search: no `migrations/002*` file exists in this branch's current tree, in **any** of the 9 branches in this repo (`bank-connection`, `calling-agent`, `card-issuing`, `dashboard`, `gmail-connector`, `identity-verification`, `portal`, `voice-verification`, `claude/vigilant-meitner-fxqi9c`), and no such file was ever added-then-deleted anywhere in full git history (`git log --all --diff-filter=A -- "migrations/002*"` returns nothing). Both `001` and `003` were added together in the single initial commit `780f9c7` — this is not a deleted file, `002` was simply never allocated in this directory.

Likely explanation (from that commit's own message): `bank-connection` has a *separate* `db/migrations/0002_users.sql` (different directory, different 4-digit filename scheme, same repo/DB) that created its own `users` table first. Portal's commit message discusses reconciling with that file directly. It's plausible whoever numbered these files treated bank-connection's `0002_users.sql` as an informal "002" already spoken for — but that file lives in a completely different directory (`db/migrations/` vs `migrations/`) and is tracked by its own filename in the shared `_migrations` table, so it doesn't actually occupy portal's numbering; the gap is real, just cosmetic (no functional impact — `scripts/migrate.mjs` applies whatever `.sql` files exist, in sorted filename order, regardless of gaps).

### 10.3 Subdomain: conflicting claims

The task brief for this doc states the subdomain is `login.getvouch.club`. Portal's **own** `CLAUDE.md` states the opposite:

> "Deploy: same Vercel project (`acme-1b76/vouch`), this branch bound to **the apex domain (`getvouch.club`)** via Git Branch Domains, same as `bank-connection` → `bankconnection.getvouch.club`."

A third, independent data point sides with `login.getvouch.club`: `bank-connection`'s `middleware.ts` hardcodes its unauthenticated-redirect fallback as `process.env.PORTAL_LOGIN_URL ?? "https://login.getvouch.club/login"`. Two independent sources (task brief + a sibling branch's fallback default) agree on `login.getvouch.club`; only portal's own `CLAUDE.md` claims the apex domain — that line looks stale. Actual Vercel domain bindings live outside the git repo and can't be verified from source alone.

### 10.4 `?next=` redirect parameter not honored

See [§8](#8-post-auth-redirect-target) — `bank-connection` appends `?next=<url>` expecting to land the user back where they came from after auth; portal ignores all query parameters and always continues through the fixed `GMAIL_CONNECTOR_URL` chain.

### 10.5 `user_profiles` is dead schema on this branch

See [§5](#5-database-schema) — the table and every one of its columns are unreferenced by any current code path; the onboarding UI that used to write to it was deleted in `6e853e8`. `bank_connected` is never set `true` by anything here (documented in `CLAUDE.md` as still needing to be wired from `bank-connection`'s exchange-token route).

### 10.6 `GMAIL_CONNECTOR_URL` missing from `.env.example`

Every other env var this branch reads (`DATABASE_URL`, `JWT_SECRET`, `SESSION_COOKIE_DOMAIN`) is documented in `.env.example`; `GMAIL_CONNECTOR_URL` (read in both `-extend` pages, each with its own duplicated hardcoded fallback) is not.

### 10.7 `JWT_SECRET` throws eagerly, unlike `DATABASE_URL`

`src/lib/db.ts`'s `Pool` is deliberately constructed **lazily** (via a `Proxy`, first touched on an actual query) specifically so that importing the module doesn't crash `next build`'s route analysis when `DATABASE_URL` isn't set yet — this exact fix is called out twice in git history (commit `5054074`, "Fix: lazily construct the pg pool instead of at module load", and restated in `780f9c7`'s message as one of "two real bugs fixed while wiring [portal] in").

`src/lib/auth.ts` was **not** given the same treatment:
```ts
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set");
}
```
This executes at module-evaluation time. Every API route here (`login`, `signup`, `logout`, `me`) imports from `@/lib/auth` at the top of the file, as do the `login-extend`/`signup-extend`/`page.tsx` pages. If `JWT_SECRET` is ever unset in an environment where these modules get imported during `next build` (e.g., a fresh Preview deploy before secrets are configured — exactly the scenario the `db.ts` fix was written to survive), this could reproduce the same class of build failure. Not confirmed by actually running a build without the secret set; flagged as a risk based on the parallel to the documented `db.ts` history.

### 10.8 Orphaned `LogoutButton` component

`src/components/logout-button.tsx` is exported but not imported/rendered anywhere on this branch (confirmed via grep). Both post-auth pages (`login-extend`, `signup-extend`) immediately leave the portal's own domain, so there is currently no page here where a "logged in, staying put" state with a visible logout affordance would appear.

### 10.9 Unused starter-template assets

`public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` are the default `create-next-app` boilerplate icons, confirmed unreferenced by any code on this branch.
