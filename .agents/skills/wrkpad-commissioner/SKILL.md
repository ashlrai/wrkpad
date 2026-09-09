---
name: wrkpad-commissioner
description: Commission or diagnose a Work Louder Creator Micro 2 for wrkpad, Codex Desktop, Claude Code, or cmux when connection, profile, shortcuts, permissions, or physical-input evidence is incomplete.
---

# Wrkpad Commissioner

Turn an ambiguous “connected but nothing happens” report into the highest
proven state and one safe next action. Keep USB discovery, Input profile state,
shortcut ownership, native Codex integration, and physical acceptance separate.

## Start

1. Read `AGENTS.md`, `docs/commissioner-architecture.md`, and
   `docs/agent-operations.md`. Read `app/docs/hybrid-native-profile.md` only for
   `hybrid_native` work.
2. Run `node tools/agent-preflight.mjs inspect --route <route> --json` and
   `node app/scripts/doctor.mjs --json` from the repository root.
3. Use `ashlr_layer` for shared Codex and Claude Code/cmux controls,
   `codex_native` for Codex-owned keys and lighting, or `hybrid_native` only
   when its two acceptance planes are explicitly intended. Never merge their
   receipts.

## Advance the session

- Prefer an already exact, active profile. Do not rewrite configuration merely
  because physical acceptance is pending.
- Agents may inspect visible macOS and Work Louder Input state with computer
  use. Never infer the active device layer from the Input editor header.
- For profile changes, require a fresh content-bound plan, exact app and device
  identity, one receiver, and a private vendor-UI export of the live before
  state. Hash the candidate and backup before the first write.
- Operate only visible Work Louder Input UI: import the bound candidate, make it
  current, select the intended layer, gracefully quit and cold-relaunch Input,
  then verify checksum and semantics. On mismatch, perform the one bound
  rollback and repeat readback. Stop if any dialog or artifact differs from the
  plan.
- The embedded executor is currently unconfigured. Treat `external_only` as an
  instruction for a capable enrolled agent to use visible UI, never as a device
  write available through Electron IPC.
- Do not edit Input caches, call private IPC, synthesize acceptance keys, use
  raw HID, reset/delete profiles, flash firmware, or kill controller processes.
  Do not change macOS TCC permissions; an agent may visually report their
  current setting.
- After configuration readback, arm Flight Check and record real board events.
  A person or a separately qualified physical fixture must move the controls;
  software-generated events are not evidence.

## Finish

Report source, tests, package/install identity, provider receipt, physical
receipt, current receiver state, Input trust/profile state, rollback artifact,
and remaining gate independently. Say `not performed`, `pending`, or `blocked`
instead of promoting one proof layer into another.
