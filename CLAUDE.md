# CLAUDE.md

Guidance for Claude Code when working in this repository.

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

### Notes

- Some sandboxed/CI environments restrict outbound network access and may
  block `cli.tigerdata.com` or `packagecloud.io`; if the install command
  fails with a network/policy error, install the CLI on an unrestricted
  machine or request the host be allowlisted.
- Verify the install with `tiger --version`.
