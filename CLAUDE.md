# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Deployment

Deployed on Vercel (`acme-1b76/vouch`), connected to this GitHub repo. Pushes
to `claude/vigilant-meitner-fxqi9c` (the production branch) auto-deploy to
production. `DATABASE_URL` is set as a Production env var in the Vercel
project — add it to Preview too if preview deploys need DB access (preview
URLs are also gated by Vercel's SSO-based Deployment Protection by default).

## Service branches (one repo, one DB, per-service subdomain)

This is a single portal built by one person, with each onboarding step
(Gmail, voice agents, bank connection, temporary card generator, …) as its
own service. Convention, established with `bank-connection`:

- **One repo, one shared Tiger DB.** Every service branch reads the same
  `DATABASE_URL` and shares `lib/db.ts`. Don't fork the DB connection setup
  per service — extend the shared schema/migrations instead (see
  `db/migrations/`).
- **One long-lived branch per service**, forked from this branch
  (`claude/vigilant-meitner-fxqi9c`), e.g. `bank-connection`. Not a
  short-lived feature branch meant to merge immediately — it stays deployed
  independently until the service is ready to fold into production.
- **One subdomain per branch**, bound via Vercel's Git Branch Domains
  (Project Settings → Domains → attach a domain to a specific branch, or
  `PATCH /v9/projects/:id/domains/:domain` with `{"gitBranch": "<branch>"}`
  — see `docs/PLAID.md` for the worked example with
  `bankconnection.getvouch.club`). Each branch's push auto-deploys to its
  own subdomain via the existing GitHub → Vercel connection; no new Vercel
  project needed.
- **Env vars are per-environment, not inherited.** A new service branch
  deploys to Vercel's *Preview* environment (only the branch in
  `productionBranch` deploys to *Production*), so `DATABASE_URL` and any
  service-specific secrets (e.g. `PLAID_*`) need to be added to Preview
  explicitly — see `vercel env add <NAME> preview`.
- Preview deployments (including custom domains on non-production
  branches) sit behind Vercel's SSO-based Deployment Protection by
  default — fine for you to browse, but it blocks third-party callbacks
  (webhooks) unless bypassed. Decide this per-service; it's a
  security-relevant setting, not a default to flip silently.
- When a service is ready for real users, merge its branch into
  `claude/vigilant-meitner-fxqi9c` (or promote it directly) rather than
  rebuilding it on the production branch.

## Tiger CLI

[Tiger CLI](https://github.com/timescale/tiger-cli) is TigerData's command-line
interface for Tiger Cloud (Postgres/TimescaleDB). It also bundles an MCP
server for coding agents.

### Install

Pick the method for your platform:

- **Linux/macOS (quick install):**
  ```sh
  curl -fsSL https://cli.tigerdata.com | sh
  ```
- **Windows (PowerShell):**
  ```powershell
  irm https://cli.tigerdata.com/install.ps1 | iex
  ```
- **macOS (Homebrew):**
  ```sh
  brew install --cask timescale/tap/tiger-cli
  ```
- **Debian/Ubuntu:**
  ```sh
  curl -s https://packagecloud.io/install/repositories/timescale/tiger-cli/script.deb.sh | sudo os=any dist=any bash
  sudo apt-get install tiger-cli
  ```
- **RPM-based Linux:**
  ```sh
  curl -s https://packagecloud.io/install/repositories/timescale/tiger-cli/script.rpm.sh | sudo os=rpm_any dist=rpm_any bash
  sudo yum install tiger-cli
  ```

### Building from source (network-restricted environments)

Some sandboxed/CI environments block `cli.tigerdata.com` and
`packagecloud.io` at the egress proxy. `github.com` (via `git clone`) and
`proxy.golang.org` (the Go module proxy) are typically still reachable, so
building from source works as a fallback:

```sh
git clone --depth 1 https://github.com/timescale/tiger-cli.git
cd tiger-cli
CGO_ENABLED=0 go build -o /usr/local/bin/tiger ./cmd/tiger
```

Requires a Go toolchain matching (or newer than) the `go` directive in
`go.mod`; `GOTOOLCHAIN=auto` (the default) will fetch a matching toolchain
via `proxy.golang.org` automatically. The resulting binary reports its
version as `dev` since it isn't built with the project's release ldflags.

### Notes

- If the install command fails with a network/policy error, either build
  from source (above) or request the relevant host be allowlisted.
- Verify the install with `tiger version`.
