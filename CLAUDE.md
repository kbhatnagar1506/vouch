# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Deployment

Deployed on Vercel (`acme-1b76/vouch`), connected to this GitHub repo. Pushes
to `claude/vigilant-meitner-fxqi9c` (the production branch) auto-deploy to
production. `DATABASE_URL` is set as a Production env var in the Vercel
project — add it to Preview too if preview deploys need DB access (preview
URLs are also gated by Vercel's SSO-based Deployment Protection by default).

## Bank connections (Plaid)

The `bank-connection` branch adds Plaid-based bank account linking
(Plaid Link, transaction sync via webhooks, encrypted access tokens). See
`docs/PLAID.md` for the full setup, data model, and deployment/subdomain
instructions.

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
