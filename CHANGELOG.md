# Changelog

All notable changes will be documented here. The project follows semantic versioning after the first public release.

## Unreleased

### Added

- Native Rust CLI/TUI and reusable library modules.
- Read-only device-family doctor and competing-owner diagnostics.
- Authenticated loopback HASP with private sticky six-slot persistence.
- Claude Code and Codex hook normalization with content redaction.
- Black-opaque desired-lighting model and declarative Creator Micro 2 layout.
- Fail-closed occupancy state machine.
- Pure Report 6 framing/reassembly fixtures with read-only RPC allowlist.
- Exact Creator Micro 2 physical-twin TUI with terminal cleanup on errors and exit.
- Typed USB-versus-HID doctor conclusions and truthful identity-only HID evidence output.
- Guarded hook status/plan/install/repair/uninstall with ownership markers and private backups.
- Opt-in per-user macOS LaunchAgent lifecycle with fixed argv, executable/content confirmation, authenticated health, and rollback.
- Distinct Codex subagent slot identities and explicit `wrkpad forget AG` recovery.

### Safety boundary

- HID writes, keymap changes, profile changes, firmware operations, and automatic process termination are intentionally unavailable.

### Security

- Refuse non-loopback HASP client endpoints and browser-origin requests.
- Refuse symlinked token/state files and durably sync state-directory replacements on Unix.
- Strip provider session titles and terminal control characters before events enter the local protocol.
- Bound retained idempotency identifiers and pin every GitHub Action to a full commit SHA.
- Roll back in-memory state when persistence fails and accept bracketed IPv6 loopback Host values.
- Bind hook confirmations to proposed content; reject duplicates, near-match deletion, oversized files, dangling/parent symlinks, and stale plans.
