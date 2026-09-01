# Agent operations

This is the canonical runbook for using wrkpad with Codex Desktop/CLI, Claude
Code in cmux, Claude Desktop, Ashlr Agent Board, and Ashlr Hub. It tells an agent
what it may inspect or automate and where a human must take over.

Repository instructions follow Codex's
[`AGENTS.md` discovery](https://developers.openai.com/codex/guides/agents-md/).
Claude Code reads [`CLAUDE.md`](https://code.claude.com/docs/en/memory), which
imports the same root contract. Restart an agent session after changing either
file; instruction loading is session-scoped.

## Choose one board route

| Route | Use it for | Owner | Acceptance gate |
| --- | --- | --- | --- |
| `ashlr_layer` | Daily Codex, Claude Code/cmux, and provider-neutral shortcuts | Work Louder Input emits shortcuts; Agent Board observes | Corrected Input profile, Input Monitoring, and 19-gesture Flight Check |
| `codex_native` | Exclusive Codex thread keys and native lighting qualification | Codex Desktop vendor protocol | Successful `v.oai.rgbcfg`, then `v.oai.thstatus`, followed by physical acceptance |

The routes can exist on the same desk, but they are not one readiness state. Do
not run an Ashlr Flight Check and call it native Codex acceptance. Do not treat
native Codex RGB as evidence that Claude Code or HASP hooks work.

## Run the read-only preflight

From the repository root:

```bash
node tools/agent-preflight.mjs inspect --route ashlr_layer --json
```

For the exclusive native route:

```bash
node tools/agent-preflight.mjs inspect --route codex_native --json
```

The output conforms to
[`dev.wrkpad.agent-preflight/v1`](../schemas/agent-preflight-v1.schema.json).
Every check names an actor and safety class. Every next step says what it proves
and what it does not prove. Firmware, device-write, permission, and
consequential steps deliberately have no executable command.

`requested_route` is the route being inspected; `declared_route` is the current
Agent Board setting when it can be read. A mismatch is explicit and never
silently promoted to readiness. The shareable receipt omits the local branch
name and other repository-identifying detail.

Preflight resolves a stable installed `wrkpad` before checking hooks or the
service. It never uses `target/release/wrkpad` for installed ownership: service
and hook plans bind the executable path and SHA-256, so a build-tree binary can
truthfully appear foreign even when the stable installation is healthy. The
preflight executes the installed binary only when its SHA-256 byte-matches the
current local release artifact; an installed path or local byte match is not
proof of source identity, review, provenance, signing, or release.

## Authority matrix

| Operation | Agent may run | Human required | Canonical procedure |
| --- | --- | --- | --- |
| Git/source inspection, doctors, status, tests, lint, build | Yes | No | `AGENTS.md` and preflight |
| Generate a new offline profile artifact | Yes, in requested scope | Human reviews/imports/activates | [Agent Board setup](../app/docs/setup.md) |
| Hook or LaunchAgent status and plan | Yes | Human authorizes exact apply plan | [Hook setup](hook-setup.md), [macOS service](macos-service.md) |
| Codex hook trust and disposable provider receipt | No | Yes | [Hook runtime verification](hook-setup.md#runtime-verification) |
| Input Monitoring or Input profile activation | No | Yes | [Agent Board setup](../app/docs/setup.md) |
| Physical Flight Check | Agent may arm/suppress actions | Human moves every real control | [Flight Check](../app/docs/setup.md#run-flight-check) |
| Firmware, bootloader, HID, keymap, or device filesystem | No | Foreground human qualification | [Firmware qualification](../app/docs/setup.md#3-install-work-louder-input) |
| Push, merge, release, deploy, publish, spend, credentials, provider approval | Only when explicitly requested | Explicit authorization and reconciliation | Project/release policy |

## Daily cross-provider sequence

1. Start with `ashlr_layer` preflight and read every `blocked` or `manual` item.
2. Confirm the stable binary is a user/system install, not a build-tree path.
3. Inspect service and hook status. Use guarded plan/apply only when the user
   requested configuration changes.
4. Have the operator trust only the exact wrkpad Codex hooks in `/hooks` and run
   one disposable Codex and Claude Code receipt. Claude Desktop chats do not
   expose the Claude Code hook lifecycle.
5. Have the operator use Input's **Set as current profile** action for `Ashlr
   Agent Board Corrected`, verify `Ashlr Daily`, and grant Input Monitoring.
   Inspect the read-only `input_profile` receipt, but do not treat it as board
   synchronization. If a fresh stale/protected layer is reported, stop: do not
   delete or transform `KV_OAI_*`; use the Input-only recovery procedure.
6. Arm Daily Flight Check. Wait for the screen to say actions are suppressed,
   then have the operator complete all 19 gestures on the physical board.
7. Operate from Agent Board. Slot selection may foreground Codex Desktop or
   cmux; it does not prove exact Codex task or cmux pane focus and sends no
   prompt or terminal input.
8. Use Ashlr Hub status/briefs as read-only evidence. Fleet pause/resume/stop
   retains confirmation or hold; inbox decisions and production actions remain
   outside this daily shortcut path.

## Native Codex recovery handoff

When Codex discovers `303A:8298` but preflight reports
`firmware_rpc_missing`, reconnection, Bluetooth changes, Input Monitoring, and
quitting Logitech do not add the missing RPC. The operator must decide whether
to keep the working shared route or run the separate firmware qualification.

An agent may prepare the vendor release identity, checksum, backups, and
post-flash test plan. It must stop before quitting applications, entering a
bootloader, or flashing. The human handoff must name:

- exact board identity, current firmware, candidate tag/asset/size/checksum;
- direct-power and competing-owner requirements;
- recovery or rollback evidence, including an explicit warning when absent;
- `rgbcfg` then `thstatus` acceptance;
- profile reconciliation, all physical controls, reconnect, and sleep/wake.

## Agent handoff format

End substantial work with:

```text
Source: <full SHA and dirty state>
Implemented: <source behavior>
Verified: <commands and results>
Packaged/installed: <exact state or not performed>
Provider receipt: <accepted, failed, or not performed>
Physical receipt: <accepted, failed, or not performed>
Public release: <artifact/tag or not performed>
Remaining human gates: <permission, firmware, trust, physical, approval>
Rollback: <artifact or procedure, or explicitly unavailable>
```

This format prevents a green source check from silently becoming a claim about
hardware, providers, distribution, or user acceptance.
