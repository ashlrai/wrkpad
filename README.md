# wrkpad

[![Core CI](https://github.com/ashlrai/wrkpad/actions/workflows/ci.yml/badge.svg)](https://github.com/ashlrai/wrkpad/actions/workflows/ci.yml)
[![Agent Board CI](https://github.com/ashlrai/wrkpad/actions/workflows/agent-board-ci.yml/badge.svg)](https://github.com/ashlrai/wrkpad/actions/workflows/agent-board-ci.yml)
[![Security](https://github.com/ashlrai/wrkpad/actions/workflows/security.yml/badge.svg)](https://github.com/ashlrai/wrkpad/actions/workflows/security.yml)
[![Licenses: MIT core and Apache-2.0 app](https://img.shields.io/badge/licenses-MIT%20core%20%7C%20Apache--2.0%20app-2f6feb)](#license)

[Project landing page source](site/index.html) · [Machine-readable capabilities](site/capabilities.json)

**A local-first control plane and on-screen mission control for Work Louder
Creator Micro 2, Codex, Claude Code, and agentic engineering fleets.**

`wrkpad` turns provider lifecycle events into an authenticated six-slot status
model. Ashlr Agent Board mirrors the physical `2 + 4` Agent-key geometry on
screen, so opaque black keycaps remain understandable without replacement caps
or firmware lighting.

> [!NOTE]
> **Developer preview:** source, CI, and unsigned local packaging are available.
> There is not yet a signed, notarized, immutable public macOS release. See the
> [release evidence layers](docs/release.md) before making distribution claims.

```text
DIAL  | AG00  | AG01  | STICK
AG02  | AG03  | AG04  | AG05
ACT06 | ACT07 | ACT08 | ACT09
TOUCH | ACT10 | ACT11 | ACT12 (transparent)
```

This matrix is the canonical control-group order. The
[landing page](site/index.html#demo) includes an original, clearly synthetic
CSS screen twin with black caps; it is an interaction guide, not vendor artwork
or a dimensional product rendering. Real product photography remains linked
only from Work Louder while reuse permission is unrecorded. See
[architecture and trust boundaries](app/docs/architecture.md).

The project is local-first and fail-closed. It preserves Codex and Claude's own
permission systems, performs no HID writes, and contains no one-press push,
merge, deploy, publish, delete, spend, credential, or permission-approval action.

The recommended macOS configuration is a guarded
[Dual Plane profile](app/docs/dual-plane-profile.md): Codex Native remains
firmware layer 1, while layer 2 provides the stable mixed Codex + Claude Code
workflow. Generation is offline; Input import, activation, and both physical
acceptance checks remain explicit human operations.

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
- The movable Compact Deck gives people without the hardware the same six-slot
  attention runway, window-scoped numpad controls, privacy switch, and four
  provider-neutral delivery skills. It never installs a global keyboard hook.
- Across the four daily lenses, ACT06–ACT09 keep stable Amplify, Verify, Polish,
  and Advance muscle memory; ACT10 stages Voice, ACT11 copies a bounded next-step
  brief for review, and transparent ACT12 opens the highest-priority observed
  provider surface. Recovery deliberately replaces only ACT06–ACT09 with
  guarded fleet controls.
- On Ashlr Layer, Agent Board maps 20 shortcuts across five software lenses,
  guards consequential actions, and exports a hashed operator-guided Flight
  Check receipt. Codex Native and an unselected route keep mapped actions off.
- Agent Board keeps Codex Native and the cross-provider Ashlr Layer as explicit,
  local-only route declarations; neither is inferred or applied to the board.
- A privacy-bounded native diagnostic distinguishes historical RPC failures
  from a fresh, inferred initialization sequence while keeping the manual
  Settings connection and physical acceptance separate from the shortcut route.
- A restart-safe Codex Native handoff first verifies Agent Board released its
  shortcuts, then binds that inferred sequence to the
  observed board VID:PID class and fixed-path ChatGPT Desktop metadata, then requires seven explicit
  operator observations. It stores no prompt, title, session ID, raw log,
  diagnostic detail, or local path and remains an attestation, not unique-device
  identity, running-process provenance, or restart proof.
- Privacy-bounded Input cache/runtime diagnostics report the cache-current
  profile, a uniquely observable single layer, encoder order, and exact
  unresolved-index reason codes without exposing raw logs or claiming current
  device state.
- Agent Board distinguishes **USB present** from a working shortcut route,
  verifies only sanitized Work Louder Input publisher/signature/Gatekeeper
  results, and disables shortcut ownership when more than one Agent Board
  receiver is running.
- Both components sanitize private provider content and distinguish source,
  package, integration, provider, physical, and user acceptance.

## Deliberate boundaries

- No mutation of Work Louder Input's cache/database, active profile, keymap,
  firmware, bootloader, or device filesystem. The app can create a new private
  offline profile export for an operator to review and import manually.
- No automatic quitting or killing of ChatGPT Desktop, Work Louder Input,
  Logitech, Karabiner, or provider processes.
- No exact Codex task or cmux pane focus.
- No prompt submission from an Agent slot.
- No claim that a planned color is visible through opaque black keycaps; the
  screen is the authoritative legend.
- No Developer ID-signed or notarized public macOS binary yet. CI builds and
  validates an expected-unsigned package without uploading or publishing it.

See [device interoperability](protocol/device-interoperability.md), [ownership
and recovery](docs/ownership-and-recovery.md), and [release readiness](docs/release.md).

## Quick start: core

Prerequisites: Rust 1.88 or newer and a supported desktop OS. Linux builds also
need `pkg-config` and the libudev development package (for example,
`sudo apt-get install pkg-config libudev-dev` on Ubuntu). macOS requires the
Xcode Command Line Tools; Windows requires the Visual Studio C++ build tools.

```bash
git clone https://github.com/ashlrai/wrkpad.git
cd wrkpad
cargo install --path . --locked --root "$HOME/.local"
~/.local/bin/wrkpad init
~/.local/bin/wrkpad doctor
~/.local/bin/wrkpad demo
~/.local/bin/wrkpad serve
```

In another terminal:

```bash
~/.local/bin/wrkpad status
~/.local/bin/wrkpad tui
```

The explicit `~/.local` install is intentional. Hook and service ownership is
bound to the executable path and SHA-256; never configure them from
`target/release`, which can be replaced by a later build or `cargo clean`.

On macOS, follow the guarded [background-service lifecycle](docs/macos-service.md)
before relying on hooks after a terminal closes. Hook installation remains an
explicit `status` → `plan` → apply flow. A configured hook is not proof that its
provider trusted or invoked it.

## Quick start: Agent Board

Prerequisites: macOS, Node.js 22 or newer, and npm. Work Louder Input is needed
for the cross-provider **Ashlr Layer**, but the official Codex integration does
not require it.

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

For a first native Codex test:

1. Turn on the Creator Micro 2 Pro and connect a data-capable USB-C cable.
2. Hold the bottom-left touch control for three seconds, then tap it until the
   underglow is white. The current
   [Codex Micro guide](https://learn.chatgpt.com/docs/features/codex-micro)
   warns that a cable can charge while Bluetooth remains selected.
3. Use a short touch-control tap to select layer 1. ChatGPT owns layer 1;
   [Work Louder documents](https://worklouder.cc/micro-setup) the touch control
   as the layer selector.
4. In ChatGPT's device settings, confirm **Connected** and **Input Monitoring:
   Granted**. If the permission or layer changed, fully quit and reopen ChatGPT.
   These indicators prove discovery and permission state, not that a physical
   key navigated a task.
5. Open a normal task and double-tap a different assigned Agent Key within 350
   milliseconds. The documented behavior is to switch tasks and foreground
   ChatGPT; a single tap can switch without bringing ChatGPT forward.
6. If the board is still silent, quit Karabiner or Logitech Options+ when it has
   Input Monitoring, reconnect, and run `npm run doctor`. Follow the
   [native-layer recovery guide](app/docs/codex-native-layer-recovery.md) before
   considering a reset. Work Louder states that Input's **Reset settings**
   deletes all profiles, layers, and actions, so back up first and make that
   deletion an explicit operator decision.

White underglow confirms only the firmware-selected wired transport. It does
not prove macOS enumeration, receiver exclusivity, native Codex key routing, or
a physical receipt.

## Development

AI agents should read [`AGENTS.md`](AGENTS.md); Claude Code loads the same
contract through [`CLAUDE.md`](CLAUDE.md). A dependency-free composite preflight
reports source, stable-binary, hook, service, hardware, and route evidence
without applying changes:

```bash
node tools/agent-preflight.mjs inspect --route ashlr_layer --json
node tools/agent-preflight.mjs inspect --route codex_native --json
```

Agents should read `requested_route`, `declared_route`, and `route_readiness`.
On `ashlr_layer`, also inspect the `input_profile` and `input_runtime` check
entries. Read each next step's actor, safety, and `does_not_prove`, then follow
the [Input-only reconciliation](app/docs/troubleshooting.md#input-only-reconciliation)
rather than inventing a device or permission claim.

See the [agent operations runbook](docs/agent-operations.md) for the daily
Codex/Claude workflow and human handoff gates.

Core gates:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
cargo deny check
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

Repository contract and documentation gates:

```bash
node --test tools/*.test.mjs
node tools/docs-check.mjs
git diff --check
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
- [`docs/agent-operations.md`](docs/agent-operations.md) — shared Codex, Claude,
  hardware, and release workflow for humans and agents.
- [`docs/creator-micro-2-post-flash-2026-09-02.md`](docs/creator-micro-2-post-flash-2026-09-02.md) —
  canonical dated desk evidence and remaining acceptance gates.
- [`SECURITY.md`](SECURITY.md), [`CONTRIBUTING.md`](CONTRIBUTING.md),
  [`SUPPORT.md`](SUPPORT.md), and [`CHANGELOG.md`](CHANGELOG.md) — canonical
  repository policies and project history.

## Hardware identity policy

Discovery recognizes these identities and reports the one actually observed:

| VID:PID | Classification | Evidence boundary |
| --- | --- | --- |
| `303A:8297` | Creator Micro 2 candidate | Recognized for read-only presence; community and user-supplied evidence; never sufficient for writes |
| `303A:8298` | Creator Micro 2 | Reverified over wired USB after the September 2, 2026 firmware update |
| `303A:8360` | Codex Micro | Repeated community hardware evidence |
| `574C:E6E3` | Legacy Work Louder Micro v1 | QMK explanation only; current-generation protocol is forbidden |

VID/PID alone never selects a writable adapter. The compatibility key also
requires strings, transport, usage pair, descriptor digest, firmware, active
layer, accepted capabilities, visible result, and a release path.

## Current evidence

On September 2, 2026, the tested Creator Micro 2 `303A:8298` was updated from
firmware `v0.1.50` to `0.6.2`, re-enumerated over wired USB, and returned
successful results for both required Codex RPC methods. Input then repeated its
known single sealed-resource mutation and is unverified for another
Input-controlled operation. At the recorded post-update snapshot, Input and
Agent Board were stopped; native Codex connection, visible lighting, post-update
Flight Check, provider receipt, and operator acceptance remained unproven. See
the canonical
[post-flash evidence record](docs/creator-micro-2-post-flash-2026-09-02.md) for
timestamps, descriptor hashes, topology, and evidence boundaries.

Automated source checks and local package creation do not prove installed hooks,
provider receipt, physical gesture completion, RGB support, signed distribution,
or user acceptance.

## License

Files outside `app/` are MIT under [LICENSE-MIT](LICENSE-MIT). Files inside
`app/` are Apache-2.0 under [app/LICENSE](app/LICENSE); redistribution must retain
[app/NOTICE](app/NOTICE). No license choice crosses those scopes unless a file
explicitly says otherwise. Community protocol work must preserve attribution and
must not copy from unlicensed prior art.
