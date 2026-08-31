# Ashlr Agent Board

A local-first macOS control plane for the Work Louder Codex Micro.

## Daily model

- The six Agent keys are one stable attention map across every software lens.
- The on-screen runway mirrors the board exactly: `DIAL | AG00 | AG01 | STICK`, then `AG02 | AG03 | AG04 | AG05`.
- Provider is an icon and label. State owns color: error red, needs-you amber, working blue, ready-to-review green, idle purple, and off black.
- Opaque black keycaps are the default experience. The screen is the authoritative legend; a frosted hero cap is optional, and physical edge/underglow is not claimed until firmware transport is qualified.
- Selecting a live Codex slot opens Codex Desktop. Selecting a live Claude Code slot opens cmux. Current focus is app-level only; the app says so and never sends terminal input or a prompt.
- The Fleet brief is read-only and exception-first: blocker, eligible work, proof mode, and next safe action. Proposal disposition and release actions do not exist on the board.

`wrkpad status --json` and `ashlr fleet status --json` are read through bounded, shell-free local adapters. Renderer snapshots omit session identifiers, working-directory paths, prompts, transcript content, tool arguments, and raw Fleet payloads.

## Commands

```bash
npm install
npm run doctor
npm test
npm run lint
npm run build
npm run dev
npm run package:mac
```

The packaged app is emitted to `release/mac-arm64/Ashlr Agent Board.app`.

## Safety

- Renderer IPC accepts allowlisted action IDs only.
- Read-only inspection actions run immediately.
- Agent sessions and tests require an explicit confirmation.
- Fleet authority actions require a single-use token and press-and-hold confirmation.
- Hold duration is measured continuously by the Electron main process.
- Flight Check blocks mapped actions in the main process and evaluates receipts from main-owned raw signals.
- Workspace Pulse reports Git/toolchain facts locally and never labels an unknown repository state clean.
- No push, merge, deploy, publish, delete, spend, credential, or permission-approval executor exists.
- A parseable response is not automatically called healthy: invalid `wrkpad` or Fleet schemas render as invalid evidence rather than authoritative zeroes.
- Claude startup repository mutation is detected and surfaced as an operator warning; the app does not silently edit global Claude configuration.

See `../ASHLR_AGENT_BOARD.md` for hardware setup, physical mapping, verification, and the expansion roadmap.
