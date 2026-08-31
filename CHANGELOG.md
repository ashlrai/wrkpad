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

### Safety boundary

- HID writes, keymap changes, profile changes, firmware operations, and automatic process termination are intentionally unavailable.

### Security

- Refuse non-loopback HASP client endpoints and browser-origin requests.
- Refuse symlinked token/state files and durably sync state-directory replacements on Unix.
- Strip provider session titles and terminal control characters before events enter the local protocol.
- Bound retained idempotency identifiers and pin every GitHub Action to a full commit SHA.
