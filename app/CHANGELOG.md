# Changelog

All notable changes to Ashlr Agent Board will be documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Recognize Work Louder's official lowercase `input.app` installation name
  without weakening fixed-path, canonical-path, or bundle-integrity checks.

### Added

- Route-aware doctor metadata for agents, including a stable schema, timestamp,
  declared route, read-only marker, and separate prerequisite, native, and
  Ashlr Layer readiness.
- Public project documentation, contribution guidance, support boundaries, and release criteria.
- Source-SHA and SHA-256 audit manifest for ephemeral unsigned package checks;
  public CI does not upload the application binary.
- Fixed-data, action-disabled public screenshot harness with synthetic agent
  states and no local paths, device claims, or remote authority.
- Local-first Electron mission control for Creator Micro 2 on macOS.
- Six-slot black-cap attention runway with provider, title, icon, text, and state color.
- Stable `2 + 4` Agent-key geometry across five software lenses.
- Bounded adapters for `wrkpad status --json` and `ashlr fleet status --json`.
- App-level Codex Desktop and cmux focus without prompt or terminal submission.
- Allowlisted safe, confirm, and continuous-hold action execution.
- Main-process Flight Check interlock and hashed local receipt export.
- Local workspace inspection and guarded engineering briefs.
- Accessibility labels and polite announcements for new error and needs-input states.
- Synthetic provider-contract fixtures and structured compatibility reason codes
  for wrkpad HASP v1 and the Ashlr Fleet adapter.
- Required, optional, and manual doctor categories with a single prioritized
  recovery action.
- A local-only Board Route declaration that separates expected Codex Native and
  Ashlr Layer behavior without changing device state.
- Privacy-bounded native Codex diagnostics that identify the exact
  `v.oai.rgbcfg` firmware RPC 404 instead of reporting a generic connection
  failure.
- A black-opaque Creator Micro 2 screen twin and route-aware readiness copy.
- A fail-closed Input profile transformer with verified clockwise,
  counterclockwise, press encoder serialization.
- A timed zero-signal recovery panel that distinguishes the rotary dial,
  joystick, and firmware-owned layer/connection touch selector.
- Sanitized Work Louder Input integrity and Agent Board receiver diagnostics;
  Flight Check fails closed until the vendor app verifies and one hashed
  receiver owns the shortcuts.
- A single-instance receiver policy that focuses an existing copy and exposes
  manual recovery when legacy and current builds contend without killing either.
- A bounded, read-only Input cache receipt that identifies the active profile,
  layer, and known reversed encoder mapping without exposing macros or paths.
- Privacy-safe detection of recurring Codex-protocol responses reaching Input,
  reported as controller co-presence rather than HID ownership or root cause.
- An in-app, offline profile-repair flow that validates an ordinary export and
  saves a uniquely named, allowlisted, mode-`0600` corrected artifact without
  opening Input, changing its cache, or writing the device.
- A bounded private recovery handoff, resumable in Setup with the exact
  Input-only checklist, Finder reveal, checklist copy, and permission-settings
  navigation while preserving all human/device-write gates.
- One shared bounded identity contract for the desk-verified `303A:8298` device
  and the read-only `303A:8297` candidate.

### Changed

- Replace stale pre-flash setup, troubleshooting, ownership, and readiness
  claims with a canonical September 2 evidence record that keeps firmware RPC
  success separate from native Codex and physical acceptance.
- Fail closed instead of guessing `npm test` for Cargo, Go, ambiguous polyglot,
  or unsupported workspaces.
- Label CLI presence, observer receipts, and desktop shortcut registration as
  separate readiness evidence.
- Block Flight Check until USB and all desktop endpoints are ready, stop a
  failed run immediately, and offer a clean restart after a misroute.
- Keep operator safety notices visible even when Fleet evidence is unavailable.
- Separate USB detection, native firmware compatibility, route declaration,
  desktop endpoint registration, and physical acceptance in Setup and doctor.
- Correct the screen twin and canonical layout to place the white joystick at
  top-left and the black rotary dial at top-right.
- Refuse to arm Flight Check when the active Input receipt has a known reversed
  encoder, reserve Setup readiness for the exact corrected profile receipt, and
  keep daily and disposable diagnostic acceptance gates distinct.
- Revalidate USB, signed Input, exact profile/layer, exclusive receiver, and all
  20 shortcut registrations in the trusted main process before Flight Check
  start, restart, or a passing receipt export.
- Cache only identity-stable bounded receiver hashes and the short-lived Input
  integrity result so recurring status refreshes do not stall physical control
  handling; development builds now fail closed around packaged peers.
- Treat the observed Input 0.18.4 sealed window-info helper mutation as an explicit
  unverified state with stopped-state backup, reinstall, and pre-launch
  verification guidance; it never authorizes firmware work.
- Make live Flight Check acceptance revocable and generation-bound: a gate
  regression, superseding stop/restart, stale status response, or in-flight
  export can no longer preserve or recreate a passing receipt.

### Security

- Bind Input metadata, publisher, signature, and Gatekeeper probes to one
  canonical unchanged bundle fingerprint; reject direct or ancestor symlinks
  and reconfirm publisher identity after strict verification.
- Bound all Input integrity retries to one ten-second monotonic budget and run a
  final strict signature check after Gatekeeper before reporting verification.
- Route automatic and one-press Git inspection through a fixed, hardened Git
  runner that disables repository fsmonitor, external diff, textconv, optional
  locks, pagers, prompts, and inherited `GIT_*` process injection.

### Not included

- Physical RGB or firmware writes.
- Exact provider task or terminal pane focus.
- Signed, notarized, or published macOS artifacts.
- Provider activation or physical user acceptance.

[Unreleased]: https://github.com/ashlrai/wrkpad/commits/main/app
