# Ashlr Agent Board

**A local-first macOS mission control for the Work Louder Creator Micro 2.**

Ashlr Agent Board gives opaque black keycaps a complete on-screen legend, keeps six Codex and Claude Code sessions on one stable physical map, and puts guarded engineering actions behind explicit safety levels. It observes local tools; it does not replace their permission systems.

> [!IMPORTANT]
> Physical status lighting is not implemented. The on-screen runway is authoritative. Selecting a slot opens Codex Desktop or cmux at the application level; exact task or pane focus is not available.

## Why this exists

The Creator Micro 2 has six Agent keys but black keycaps cannot communicate state by themselves. Agent Board mirrors their exact `2 + 4` geometry:

```text
STICK | AG00 | AG01 | DIAL
      AG02 | AG03 | AG04 | AG05
```

Every slot combines provider, task title, icon, text state, and color. The experience therefore works without replacement keycaps and remains understandable without color alone.

| State | Meaning | Color |
| --- | --- | --- |
| Error | The session failed or needs recovery | Red |
| Needs you | Human input or a decision is required | Amber |
| Working | The agent is actively working | Blue |
| Ready to review | Output is waiting for review | Green |
| Idle | A known session is inactive | Purple |
| Available | No session occupies the slot | Black |

## What it does today

- Shows six stable, provider-neutral agent slots sourced from `wrkpad status --json`.
- Foregrounds ChatGPT for Codex slots and cmux for Claude Code slots without sending input.
- Summarizes `ashlr fleet status --json` into an exception-first operator brief.
- Maps 20 desktop shortcuts to the board's dial, joystick, Agent keys, and action switches only while the Ashlr Layer route is declared. Codex Native and unknown routes unregister every shortcut.
- Provides Attention, Pair, Fleet, Proof, and Recovery software lenses while keeping Agent keys fixed.
- Separates immediate, confirm, and press-and-hold actions in the Electron main process.
- Runs an interlocked Flight Check for all physical routes and exports a hashed local receipt.
- Presents separate Codex Native and Ashlr Layer setup flight plans, with a
  private restart-safe native handoff that rejects stale VID:PID/Desktop-metadata
  context and records only explicit operator observations. In Codex Native mode,
  a successful **Prepare handoff** verifies that Agent Board has no registered
  shortcuts, so it may stay open as a passive evidence watcher while ChatGPT
  Desktop restarts. Restart-safe means the
  handoff also survives quitting Agent Board; it does not prove a new Codex process.
- Keeps session IDs, provider working directories, prompts, transcripts, tool arguments, and raw Fleet payloads out of mission snapshots. Workspace Pulse separately shows the working directory the user selected.

See [controls and state](docs/controls.md) for the complete map and [architecture and trust](docs/architecture.md) for the security model.

## Requirements

- macOS and a Work Louder Creator Micro 2
- Node.js 22 or newer and npm for development
- **Codex Native:** ChatGPT Desktop is required for the native board route.
- **Ashlr Layer, profile repair, or firmware qualification:** [Work Louder Input](https://worklouder.cc/input/) is required for board profiles and shortcut mapping.
- Optional local integrations: Codex CLI; Claude Code, Claude Desktop, and cmux; `wrkpad`; and Ashlr Hub.

Runtime CLI discovery checks `~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, and `/usr/bin` in that order. It intentionally does not trust the inherited `PATH`. Missing optional tools appear as unavailable rather than being installed automatically.

## Get started

```bash
git clone https://github.com/ashlrai/wrkpad.git
cd wrkpad/app
npm install
npm run doctor
npm run agent:preflight
npm test
npm run dev
```

`npm run doctor` performs read-only local probes and reports anything that still needs human verification.
`npm run agent:preflight` adds stable-binary, hook, service, source, and
route-specific evidence using the shared repository contract. Append
`-- --route codex_native` only for the separate native qualification route.

Before pressing physical controls, follow [setup and Flight Check](docs/setup.md).
For **Ashlr Layer**, Work Louder Input must emit the exact shortcuts expected by
the app and macOS Input Monitoring must be granted by the user. Input's header
is the edit target, not proof of the current keyboard profile; use **Set as
current profile**, then require the read-only receipt and physical Flight Check.
For **Codex Native**, prepare the restart-safe handoff, restart ChatGPT Desktop
alone, refresh the inferred initialization evidence, and record each physical
observation manually. Neither path proves the other.

To populate the six slots with live Codex and Claude Code state, also complete
the guarded [`wrkpad` service and hook setup](../docs/hook-setup.md). A configured
hook, a trusted hook, a received lifecycle event, and a physical board signal
are separate gates.

## Develop and package

```bash
npm run dev          # Vite renderer plus Electron
npm run dev:web      # renderer only; actions are simulated
npm run agent:preflight # read-only shared Ashlr Layer readiness
npm test             # Vitest plus Electron main-process tests
npm run lint         # oxlint
npm run build        # TypeScript and production renderer
npm run capture:public-demo # privacy-safe screenshot from the real renderer
npm run package:mac  # unsigned, unpacked macOS app
```

The public-demo capture uses a fixed-data, action-disabled synthetic bridge
and writes `../docs/assets/agent-board-public-demo.png`. Its banner and fixture
data make clear that it is not live provider, hardware, RGB, or Fleet evidence.
CI executes the real fixture and validates its required states, privacy labels,
dimensions, and truncation boundary. Chromium raster output can vary even on
one runner, so screenshot refreshes remain under human visual review.

`npm run package:mac` writes an architecture-specific app under `release/`. It does not sign, notarize, publish, install, or prove physical acceptance.

## Documentation

- [Setup and Flight Check](docs/setup.md)
- [Controls and state model](docs/controls.md)
- [Architecture and trust boundaries](docs/architecture.md)
- [Provider compatibility contracts](docs/provider-contracts.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release and readiness](docs/release-readiness.md)
- [Roadmap](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)

## Current boundaries

- macOS only
- No physical RGB or firmware writes
- No exact Codex task or cmux pane focus
- No prompt submission from an Agent slot
- No one-press push, merge, deploy, publish, delete, spend, credential, or permission approval
- No signed/notarized release workflow yet
- Local CLI schemas and paths are currently integration contracts

## Project status

The source implements and tests the local desktop workflow. A local build is not the same as a signed public release, live provider activation, physical board acceptance, or user acceptance. See [release and readiness](docs/release-readiness.md) for the evidence required at each layer.

## Community

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Support requests belong in GitHub Discussions or Issues; security reports should use GitHub's private vulnerability reporting when it is enabled.

## License

The desktop app is licensed under [Apache-2.0](LICENSE). The parent `wrkpad` project has its own license at the repository root.
