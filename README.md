# wrkpad

`wrkpad` is a local-first agent status control plane for Work Louder Creator Micro 2 and Codex Micro hardware. One native Rust binary turns Claude Code and Codex lifecycle events into an authenticated six-slot status model, renders it in a TUI, and plans a high-contrast lighting frame for black opaque keycaps.

The useful path does not require HID writes. Version 0.1 starts in `observe`, keeps hardware painting disabled, and refuses takeover until an exact device, descriptor, firmware, active layer, ownership, visible result, and release path have been accepted on physical hardware.

## What works now

- `wrkpad doctor` reports separate, typed USB, HID, tool, and process evidence without opening a device, writing a report, or changing permissions.
- `wrkpad serve` runs the Hardware Agent Status Protocol (HASP) only on authenticated loopback HTTP.
- `wrkpad service status|plan|install|repair|uninstall|start|stop|restart` manages an opt-in, per-user macOS LaunchAgent with authenticated startup verification and rollback.
- `wrkpad hook` sanitizes Claude Code and Codex hook input, discarding prompts, tool arguments, transcripts, assistant text, and approval decisions.
- `wrkpad hooks status|plan|install|repair|uninstall` performs a guarded, ownership-marked merge while preserving unrelated vendor hooks.
- Six sticky session slots resolve `error > needs_input > working > unread > idle > off`.
- Codex subagents receive distinct private bindings from their parent session.
- `wrkpad forget 0..5` releases one stale local slot without stopping or changing the agent.
- `wrkpad tui` renders a read-only physical twin of `DIAL | AG00 | AG01 | JOYSTICK`, `AG02–AG05`, `ACT06–ACT09`, and `TOUCH | MIC/ACT10+ACT11 | ACT12`, with Input-owned and firmware-owned controls identified.
- `wrkpad demo` previews every state and the proposed `black-opaque` palette without hardware.
- `wrkpad occupancy` implements fail-closed `observe`, `shadow`, `takeover`, and `release` transitions.
- The private protocol module frames and reassembles community-observed 64-byte Report 6 messages but exposes read-only RPC construction only.

## What deliberately does not work yet

- No HID lighting writes.
- No keymap, layer, profile, firmware, bootloader, or device-filesystem writes.
- No automatic quitting or killing of ChatGPT Desktop, Work Louder Input, Logitech, or Karabiner.
- No agent approval, prompt submission, shell command, deployment, or financial-action API.
- No claim that a planned color is visible through Mason's physical caps.

Those are safety boundaries, not missing marketing copy. See [device interoperability](protocol/device-interoperability.md) and [ownership and recovery](docs/ownership-and-recovery.md).

## Quick start

Prerequisites: Rust 1.88 or newer and a supported desktop OS.

```bash
# From this repository checkout:
cargo build --release
./target/release/wrkpad init
./target/release/wrkpad doctor
./target/release/wrkpad demo
```

Start the local status server in one terminal:

```bash
./target/release/wrkpad serve
```

Then inspect it from another terminal:

```bash
./target/release/wrkpad status
./target/release/wrkpad tui
```

Expected result: six slots render, the local token remains in the per-user wrkpad data directory, and no hardware action occurs.

On macOS, use the stable installed binary's guarded [background-service lifecycle](docs/macos-service.md) before relying on provider hooks after a terminal closes.

If a completed or abandoned session remains sticky, release only its display slot:

```bash
./target/release/wrkpad forget 3 # AG03; does not stop the agent
```

## Hook setup

Hook installation is intentionally explicit. Run the stable binary's read-only `hooks status` and `hooks plan`, then apply that exact content-bound plan ID. The manager shell-quotes paths, refuses symlinks, preserves unrelated hooks, privately backs up existing files, and marks only its own handlers for later repair or removal. The checked-in JSON examples are reference shapes, not files to paste over existing settings.

Do not use Codex's `--dangerously-bypass-hook-trust` as a normal setup step. A configured hook is not proof that Codex trusted or ran it.

## Development

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
```

Repository map:

- [`src/`](src/) — one-binary implementation and reusable library modules.
- [`protocol/hasp.md`](protocol/hasp.md) — authenticated local status contract.
- [`protocol/device-interoperability.md`](protocol/device-interoperability.md) — reverse-engineered HID evidence boundary.
- [`layouts/creator-micro-2.json`](layouts/creator-micro-2.json) — declarative physical and optical model.
- [`docs/architecture.md`](docs/architecture.md) — components, data flow, and trust boundaries.
- [`SECURITY.md`](SECURITY.md) — threat model and vulnerability reporting.

## Hardware identity policy

Discovery recognizes these distinct identities and reports the one actually observed:

| VID:PID | Classification | Evidence boundary |
| --- | --- | --- |
| `303A:8297` | Creator Micro 2 candidate | Community hardware and user-supplied evidence; never sufficient for writes |
| `303A:8298` | Creator Micro 2 | Previously observed on the Ashlr desk unit; must be reverified live |
| `303A:8360` | Codex Micro | Repeated community hardware evidence |
| `574C:E6E3` | Legacy Work Louder Micro v1 | QMK/ATmega32U4 explanation only; current-generation protocol is forbidden |

VID/PID alone never selects a writable adapter. The exact compatibility key also includes product/manufacturer strings, transport, usage pair, descriptor SHA-256, firmware, active layer, and accepted capabilities.

## Project status

Source implementation and automated tests are not physical acceptance. During the read-only August 31, 2026 audit, macOS showed four USB host controllers but no attached USB child device and no relevant HID collection. The lit board proved power only, not USB data. Bluetooth keyboard and trackpad traffic used a separate transport and is not a credible cause; ChatGPT Desktop and Work Louder Input were running but cannot explain absence below the USB registry. No device was opened, and no descriptor, firmware, report, lighting write, permission change, or process termination was attempted.

That evidence does not identify the failed component. A charge-only or damaged cable, connector seating, port or hub, and board-side data fault remain candidates.

`wrkpad` is MIT licensed. Community protocol work must preserve attribution and may not copy from unlicensed prior art.
