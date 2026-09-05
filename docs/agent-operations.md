# Agent operations

This is the canonical runbook for using wrkpad with Codex Desktop/CLI, Claude
Code in cmux, Claude Desktop, Ashlr Agent Board, and Ashlr Hub. It tells an agent
what it may inspect, what a one-time enrollment may delegate, and which evidence
still requires the user or real hardware.

Repository instructions follow Codex's
[`AGENTS.md` discovery](https://developers.openai.com/codex/guides/agents-md/).
Claude Code reads [`CLAUDE.md`](https://code.claude.com/docs/en/memory), which
imports the same root contract. Restart an agent session after changing either
file; instruction loading is session-scoped.

## Choose one board route

| Route | Use it for | Owner | Acceptance gate |
| --- | --- | --- | --- |
| `ashlr_layer` | Daily Codex, Claude Code/cmux, and provider-neutral shortcuts | Work Louder Input emits shortcuts; Agent Board observes | Corrected Input profile, Input Monitoring, and 20-gesture Flight Check |
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
| Generate a new offline profile or fixed unofficial native-layer artifact | Yes, in requested scope | Exact artifact still needs per-run authority | [Agent Board setup](../app/docs/setup.md), [native-layer recovery](../app/docs/codex-native-layer-recovery.md) |
| Hook or LaunchAgent status and plan | Yes | Human authorizes exact apply plan | [Hook setup](hook-setup.md), [macOS service](macos-service.md) |
| Codex hook trust and disposable provider receipt | No | Yes | [Hook runtime verification](hook-setup.md#runtime-verification) |
| Input Monitoring | Agent may inspect visible state | User grants or changes macOS permission | [Agent Board setup](../app/docs/setup.md) |
| Input UI import and profile activation | Enrolled agent may operate visible UI for one content-bound plan | User enrolls once; otherwise guided handoff | [Commissioning authority](commissioner-architecture.md#authority-model) |
| Before-state backup, readback, and rollback | Enrolled executor must automate and verify all three or perform no write | User chooses retention and may revoke enrollment | [Protected apply and rollback](commissioner-architecture.md#protected-apply-and-rollback) |
| Physical Flight Check | Agent may arm, guide, and record | A person moves every real control unless a separately qualified fixture exists | [Flight Check](../app/docs/setup.md#run-flight-check) |
| Full-quit/relaunch of Agent Board or Input | No kill authority; enrolled plan may gracefully relaunch Input only | User handles other applications and unenrolled sessions | [Troubleshooting](../app/docs/troubleshooting.md#multiple-agent-board-receivers-are-running) |
| Firmware, bootloader, HID, keymap, or device filesystem | No | Foreground human qualification after verified Input | [Firmware qualification](../app/docs/setup.md#3-verify-work-louder-input) |
| Push, merge, release, deploy, publish, spend, credentials, provider approval | Only when explicitly requested | Explicit authorization and reconciliation | Project/release policy |

## Daily cross-provider sequence

1. Start with `ashlr_layer` preflight and read every `blocked` or `manual` item.
2. For a Creator Micro 2 Pro, follow the current Codex Micro guidance: ask the
   operator to open the connection selector, choose the fourth **WIRED** channel,
   and confirm white underglow. Do not infer that cable insertion left Bluetooth;
   in that state USB may only charge. Treat white as visual mode evidence only.
   A connected Bluetooth keyboard or Apple trackpad is unrelated and may remain
   connected.
3. Confirm the stable binary is a user/system install, not a build-tree path.
   Require Setup to report **One receiver · shortcut ownership available**. If
   it does not, ask the user to Command-Q every Agent Board copy and reopen one
   intended build. Never kill a process automatically; receiver exclusivity
   does not prove shortcut or physical receipt.
4. Require Work Louder Input to report **publisher, signature, and Gatekeeper
   verified**. For any sanitized failure, stop profile and firmware work and
   guide the human through reinstalling Input from the official Work Louder
   page. Do not expose raw signing output or local paths, bypass Gatekeeper, or
   delete an app.
5. Inspect service and hook status. Use guarded plan/apply only when the user
   requested configuration changes.
6. Have the operator trust only the exact wrkpad Codex hooks in `/hooks` and run
   one disposable Codex and Claude Code receipt. Claude Desktop chats do not
   expose the Claude Code hook lifecycle.
7. If the user previously enrolled visible Input UI commissioning, prepare one
   fresh content-bound plan for `Ashlr Agent Board Corrected`. Require a new
   private vendor-UI before-state export, candidate hash and semantic match,
   exact Input and device identity, single-owner window, graceful relaunch,
   checksum plus semantic readback, and one bounded rollback. If any element is
   missing, use the guided handoff instead; never downgrade to cache editing,
   private IPC, Reset Settings, profile deletion, raw HID, or synthetic keys.
   Whether agent-operated or guided, make the candidate current, verify `Ashlr
   Daily`, and have the user grant Input Monitoring.
   Inspect the read-only `input_profile` receipt, but do not treat it as board
   synchronization. If `input_runtime` reports a recent unresolved-index event,
   treat it as advisory log evidence that may predate the cache. A fresh
   physical Flight Check may supersede it; if the board remains silent, use the
   [Input-only reconciliation](../app/docs/troubleshooting.md#input-only-reconciliation)
   and never delete or transform `KV_OAI_*`.
   A fresh `input_codex_protocol_traffic` warning means recurring Codex-protocol
   responses are reaching Input. Treat it as co-presence, not HID ownership or
   root cause, and require an exclusive Input-only window. Only an enrolled
   content-bound plan may gracefully quit/relaunch Input; never kill controllers.
   If Agent Board generated a corrected artifact, preserve its private recovery
   handoff before the operator quits Codex and Agent Board. The private local
   receipt contains only the artifact path, SHA-256, and creation time; copied
   guidance omits the full path. Resume re-hashes the bounded regular artifact
   without following symlinks. Dismissing the reminder proves no recovery step,
   and the receipt does not prove import, current-profile selection, device
   synchronization, permission, or physical acceptance. On the next launch,
   resume the numbered checklist in Setup.
8. Arm Daily Flight Check. Wait for the screen to say actions are suppressed,
   then have the user complete all 20 gestures on the physical board. This
   receipt is separate from the configuration readback and cannot be synthesized.
9. Operate from Agent Board. Slot selection may foreground Codex Desktop or
   cmux; it does not prove exact Codex task or cmux pane focus and sends no
   prompt or terminal input.
10. Keep the daily action row stable across Attention, Pair, Fleet, and Proof:
    Amplify, Verify, Polish, Advance, Voice, guarded Continue, and Attention.
    The first four copy `$ashlr-delivery` invocations; Continue copies a bounded
    prompt; neither path pastes or submits. Voice only stages a local intent.
    Attention selects the highest-priority non-off slot using `error >
    needs_input > working > unread > idle`, then foregrounds only ChatGPT or
    cmux. Recovery deliberately substitutes guarded Fleet controls on the first
    four switches. The hardware geometry remains dial left, planar
    toggle/joystick right, six center Agent keys in a two-plus-four block, four
    third-row actions, then touch, ACT10, ACT11, and transparent ACT12.
11. Use Ashlr Hub status/briefs as read-only evidence. Fleet pause/resume/stop
   retains confirmation or hold; inbox decisions and production actions remain
   outside this daily shortcut path.

## Native Codex recovery handoff

When Codex discovers `303A:8298` but preflight reports
`firmware_rpc_missing`, reconnection, Bluetooth changes, Input Monitoring, and
quitting Logitech do not add the missing RPC. The operator must decide whether
to keep the working shared route or run the separate firmware qualification.

On the tested desk, the operator completed the approved update to `0.6.2` on
September 2, 2026. Both required firmware methods now return success, but native
Codex consumption and physical behavior are not yet accepted. Input also
repeated its known sealed-resource mutation after the update and must remain
closed for native qualification. See the canonical
[post-flash evidence record](creator-micro-2-post-flash-2026-09-02.md). Do not
repeat the flash merely because native acceptance is still pending.

An agent may prepare the vendor release identity, checksum, backups, and
post-flash test plan. It must stop before entering a bootloader or flashing.
The human handoff must name:

- exact board identity, current firmware, candidate tag/asset/size/checksum;
- direct-power and competing-owner requirements;
- recovery or rollback evidence, including an explicit warning when absent;
- `rgbcfg` then `thstatus` acceptance;
- profile reconciliation, all physical controls, reconnect, and sleep/wake.

When the firmware RPCs succeed but every native control is silent, a missing
`KV_OAI_*` layer is a separate configuration hypothesis. On explicit request,
an agent may generate and validate the repository's fixed
[unofficial layer artifact](../app/docs/codex-native-layer-recovery.md) offline.
An enrolled agent may import and activate that exact artifact only through the
visible Input UI and the same protected apply/readback/rollback contract. It
must not edit Input's cache, use private IPC, write the device filesystem or HID
channel directly, reset settings, or delete/transform a protected layer. Fresh
physical Codex observations remain a separate acceptance gate.

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
Remaining user or physical gates: <permission, firmware, trust, physical, approval>
Rollback: <artifact or procedure, or explicitly unavailable>
Receiver runtime: <exclusive, contended same build, contended distinct builds,
or unavailable; never include process IDs, command lines, or local paths>
Input installation: <verified version or sanitized failure; never include raw
signature output, publisher identifiers, or local paths>
Input recovery: <not needed, artifact filename plus checksum saved in a private
local handoff, imported, or physically accepted; never infer a later stage>
```

This format prevents a green source check from silently becoming a claim about
hardware, providers, distribution, or user acceptance.
