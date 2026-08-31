# wrkpad

[![Core CI](https://github.com/ashlrai/wrkpad/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/wrkpad/actions/workflows/ci.yml)
[![Agent Board CI](https://github.com/ashlrai/wrkpad/actions/workflows/agent-board-ci.yml/badge.svg)](https://github.com/ashlrai/wrkpad/actions/workflows/agent-board-ci.yml)
[![Security](https://github.com/ashlrai/wrkpad/actions/workflows/security.yml/badge.svg)](https://github.com/ashlrai/wrkpad/actions/workflows/security.yml)
[![License: MIT + Apache-2.0](https://img.shields.io/badge/license-MIT%20%2B%20Apache--2.0-2f6feb)](#license)

**A local-first control plane and on-screen mission control for Work Louder
Creator Micro 2, Codex, Claude Code, and agentic engineering fleets.**

`wrkpad` turns provider lifecycle events into an authenticated six-slot status
model. Ashlr Agent Board mirrors the physical `2 + 4` Agent-key geometry on
screen, so opaque black keycaps remain understandable without replacement caps
or firmware lighting.

```text
DIAL | AG00 | AG01 | JOYSTICK
       AG02 | AG03 | AG04 | AG05
```

The project is local-first and fail-closed. It preserves Codex and Claude's own
permission systems, performs no HID writes, and contains no one-press push,
merge, deploy, publish, delete, spend, credential, or permission-approval action.

## Two cooperating components

| Component | Purpose | Current authority |
| --- | --- | --- |
| `wrkpad` core | Native Rust CLI/TUI, authenticated loopback HASP, provider hooks, service lifecycle, device evidence, six sticky slots | Observe-only; no device writes or agent approvals |
| [Ashlr Agent Board](app/README.md) | macOS Electron mission control, black-cap runway, guarded action console, workspace/fleet briefs, physical Flight Check | Allowlisted local actions with safe, confirm, or continuous-hold levels |

The desktop app consumes bounded `wrkpad status --json` output. Each component
remains useful independently: the core has a TUI and JSON API; the app clearly
marks missing observers and optional CLIs as unavailable.

## What works now

- `wrkpad doctor` separates USB, HID, tool, and process evidence without opening
  a device, writing a report, or changing permissions.
- `wrkpad serve` exposes authenticated HASP on loopback only.
- Guarded hook and macOS LaunchAgent lifecycles preserve unrelated configuration,
  require content-bound plans, create private backups, and support rollback.
- Claude Code, Codex parent sessions, and Codex subagents resolve into six sticky
  slots with `error > needs_input > working > unread > idle > off` priority.
- `wrkpad tui`, `status`, `forget`, `occupancy`, and `demo` provide a complete
  useful path without RGB support.
- Agent Board shows provider, task title, icon, text state, and color in the exact
  black-cap geometry; selecting a slot foregrounds Codex Desktop or cmux without
  sending a prompt or terminal input.
- Agent Board maps 20 shortcuts across five software lenses, guards consequential
  actions, and exports a hashed operator-guided Flight Check receipt.
- Both components sanitize private provider content and distinguish source,
  package, integration, provider, physical, and user acceptance.

## Deliberate boundaries

- No HID lighting, keymap, layer, profile, firmware, bootloader, or
  device-filesystem writes.
- No automatic quitting or killing of ChatGPT Desktop, Work Louder Input,
  Logitech, Karabiner, or provider processes.
- No exact Codex task or cmux pane focus.
- No prompt submission from an Agent slot.
- No claim that a planned color is visible through opaque black keycaps; the
  screen is the authoritative legend.
- No signed or notarized public macOS binary yet. CI's preview artifact is
  explicitly unsigned and is not a release.

See [device interoperability](protocol/device-interoperability.md), [ownership
and recovery](docs/ownership-and-recovery.md), and [release readiness](docs/release.md).

## Quick start: core

Prerequisites: Rust 1.88 or newer and a supported desktop OS.

```bash
git clone https://github.com/ashlrai/wrkpad.git
cd wrkpad
cargo build --release
./target/release/wrkpad init
./target/release/wrkpad doctor
./target/release/wrkpad demo
./target/release/wrkpad serve
```

In another terminal:

```bash
./target/release/wrkpad status
./target/release/wrkpad tui
```

On macOS, follow the guarded [background-service lifecycle](docs/macos-service.md)
before relying on hooks after a terminal closes. Hook installation remains an
explicit `status` → `plan` → apply flow. A configured hook is not proof that its
provider trusted or invoked it.

## Quick start: Agent Board

Prerequisites: macOS, Node.js 22 or newer, npm, and Work Louder Input for real
hardware shortcut routing.

```bash
cd app
npm install
npm run doctor
npm test
npm run dev
```

Follow the [desktop setup and Flight Check](app/docs/setup.md) before using the
physical controls. `npm run package:mac` creates an unsigned, architecture-specific
local directory build; it does not install, sign, notarize, or publish anything.

## Development

Core gates:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
```

Desktop gates:

```bash
cd app
npm ci
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

Repository map:

- [`src/`](src/) — Rust binary and library modules.
- [`protocol/hasp.md`](protocol/hasp.md) — authenticated local status contract.
- [`protocol/device-interoperability.md`](protocol/device-interoperability.md) —
  reverse-engineered HID evidence boundary.
- [`layouts/creator-micro-2.json`](layouts/creator-micro-2.json) — declarative
  physical and optical model.
- [`app/`](app/) — Ashlr Agent Board desktop source.
- [`app/docs/`](app/docs/) — desktop controls, setup, architecture, troubleshooting,
  roadmap, and release gates.
- [`docs/architecture.md`](docs/architecture.md) — core components and trust boundaries.
- [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md),
  [`SUPPORT.md`](SUPPORT.md), and [`CHANGELOG.md`](CHANGELOG.md) — canonical
  repository policies and project history.

## Hardware identity policy

Discovery recognizes these identities and reports the one actually observed:

| VID:PID | Classification | Evidence boundary |
| --- | --- | --- |
| `303A:8297` | Creator Micro 2 candidate | Community and user-supplied evidence; never sufficient for writes |
| `303A:8298` | Creator Micro 2 | Reverified on the tested desk unit on August 31, 2026 |
| `303A:8360` | Codex Micro | Repeated community hardware evidence |
| `574C:E6E3` | Legacy Work Louder Micro v1 | QMK explanation only; current-generation protocol is forbidden |

VID/PID alone never selects a writable adapter. The compatibility key also
requires strings, transport, usage pair, descriptor digest, firmware, active
layer, accepted capabilities, visible result, and a release path.

## Current evidence

The August 31, 2026 desk audit enumerated a Creator Micro 2 `303A:8298` over USB
with six HID collections. The operating-system registry descriptor is 275 bytes
with SHA-256 `9257d7361f9c784e0fc0b260bbac0feadd49bf79cbb6202d6c41560cbae96fb6`;
serial data is discarded. The current Input log reports firmware `v0.1.50`, while
`device.status` and `v.oai.rgbcfg` return `Method not found`, so that unit is not
lighting-qualified. Bluetooth keyboard and trackpad traffic is unrelated.

Automated source checks and local package creation do not prove installed hooks,
provider receipt, physical gesture completion, RGB support, signed distribution,
or user acceptance.

## License

Files outside `app/` are MIT under [LICENSE-MIT](LICENSE-MIT). Files inside
`app/` are Apache-2.0 under [app/LICENSE](app/LICENSE); redistribution must retain
[app/NOTICE](app/NOTICE). No license choice crosses those scopes unless a file
explicitly says otherwise. Community protocol work must preserve attribution and
must not copy from unlicensed prior art.
