# wrkpad

`wrkpad` is a local-first agent status control plane for Work Louder Creator Micro 2 and Codex Micro hardware. One native Rust binary turns Claude Code and Codex lifecycle events into an authenticated six-slot status model, renders it in a TUI, and plans a high-contrast lighting frame for black opaque keycaps.

The useful path does not require HID writes. Version 0.1 starts in `observe`, keeps hardware painting disabled, and refuses takeover until an exact device, descriptor, firmware, active layer, ownership, visible result, and release path have been accepted on physical hardware.

## What works now

- `wrkpad doctor` discovers the current-generation device family, tools, and likely competing owners without writing or changing permissions.
- `wrkpad serve` runs the Hardware Agent Status Protocol (HASP) only on authenticated loopback HTTP.
- `wrkpad hook` sanitizes Claude Code and Codex hook input, discarding prompts, tool arguments, transcripts, assistant text, and approval decisions.
- Six sticky session slots resolve `error > needs_input > working > unread > idle > off`.
- `wrkpad tui` renders the six slots in a native terminal dashboard.
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

## Hook setup

Hook installation is intentionally explicit. Review [hook setup](docs/hook-setup.md), substitute the absolute binary path in the examples, merge only the desired entries, then inspect vendor hook trust/status.

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

Source implementation and automated tests are not physical acceptance. On August 30, 2026, the desk board was absent from USB/HID enumeration while ChatGPT Desktop and Work Louder Input were running. No lighting probe was attempted.

`wrkpad` is MIT licensed. Community protocol work must preserve attribution and may not copy from unlicensed prior art.
