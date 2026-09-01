# Repository instructions for AI agents

This is the canonical project contract for Codex, Claude Code, and other coding
agents. Keep it concise and keep provider-specific files pointed here.

## Start every task

1. Run `git status --short --branch` and `git log -5 --oneline --decorate`.
2. If Entire is already installed, run `entire status`; never install, enable,
   repair, or restore it for another contributor.
3. Read the files that establish the behavior, tests, and public claim before
   editing. Existing prose is not proof of implementation.
4. Run `node tools/agent-preflight.mjs inspect --route <route> --json` when the
   task touches setup, hooks, providers, hardware, or release readiness.
5. Choose the route explicitly: `ashlr_layer` for daily cross-provider use, or
   `codex_native` for exclusive native-firmware qualification. Never combine
   their readiness claims.
6. For hardware/setup work, inspect `requested_route`, `declared_route`, and
   `input_profile`. Never infer the current profile from Input's editor/header,
   board synchronization from cache state, or physical acceptance from either.
   Protected `KV_OAI_*` recovery is a human Input-only operation, never an agent
   rewrite or deletion.

## Repository map

- `src/`, `Cargo.toml`: Rust CLI, TUI, HASP service, hook/service lifecycle,
  hardware evidence, and observe-only occupancy policy.
- `app/`: Electron Agent Board. Read `app/AGENTS.md` before changing it.
- `protocol/`: versioned local protocols and device evidence boundaries.
- `docs/`: core setup, operations, ownership, and release procedures.
- `app/docs/`: desktop setup, controls, troubleshooting, and readiness.
- `tools/`: dependency-free repository checks intended for humans and agents.

## Safe automation boundary

Agents may perform read-only probes, source edits within the requested scope,
tests, builds, linting, and offline profile generation to a new file. Generating
a content-bound hook or service plan is read-only; applying it is a separate
mutation.

Never automate or infer authorization for:

- macOS TCC or Input Monitoring changes;
- Work Louder Input import, profile activation, keymap, device-filesystem,
  bootloader, HID, or firmware writes;
- quitting or killing Codex, Input, Logitech, Claude, cmux, or another owner;
- Codex hook trust, provider permission approval, prompt submission, or Fleet
  inbox approval/rejection;
- push, merge, deploy, publish, release, delete, spend, credential, or
  production/provider activation unless the user explicitly requests it.

Firmware work must remain a foreground human handoff with a vendor-matched
artifact, checksum, stable power, recovery plan, and post-flash physical and RPC
acceptance. A configuration backup is not a firmware rollback image.

## Truth and privacy boundaries

Keep these states separate in code, UI, docs, and handoff notes: proposed,
implemented, source-tested, packaged, installed, configured, provider-invoked,
physically accepted, user-accepted, and publicly released.

Do not expose prompts, transcripts, tool arguments, credentials, tokens, raw
provider payloads, private repository names, full local paths, HID serials, or
unredacted receipts. Use fixed synthetic fixtures. Status must remain
understandable without color alone.

## Verification by scope

Core changes:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
cargo deny check
```

Agent Board changes:

```bash
cd app
npm ci
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

Agent-contract or documentation changes:

```bash
node --test tools/*.test.mjs
node tools/docs-check.mjs
git diff --check
```

Do not silently install a missing verifier. Report the skipped gate and why.
Hardware/provider work also requires the named manual acceptance receipt; CI
cannot substitute for it.

## Change and review rules

- Reuse current schemas, reducers, validators, fixed tool resolution, and
  content-bound plan/apply lifecycles before adding a new abstraction.
- Keep renderer input bounded and sanitized; keep filesystem, process, Git, and
  executable authority in the Electron main process.
- Use argv arrays, bounded output, and timeouts. Do not add user-controlled shell
  interpolation or inherited-PATH execution to trusted paths.
- Add success, malformed-input, denial, timeout, privacy, and recovery tests for
  changed trust boundaries.
- Update the canonical setup/operations document and changelog with behavioral
  changes. Link rather than duplicate procedures.
- Preserve the dual-license boundary: root/core files are MIT; `app/` files are
  Apache-2.0 and retain `app/NOTICE`.
- Sign off every commit with `git commit -s`.

## Code review rules

Flag any change that creates an unguarded consequential action, weakens
loopback/authentication/privacy bounds, treats process absence as exclusive HID
ownership, runs hook/service operations from a build-tree binary, conflates the
two board routes, or promotes tests/builds into provider/physical/release claims.
The safe path is an explicit actor, authority class, confirmation or hold,
rollback, and evidence-layer statement.
