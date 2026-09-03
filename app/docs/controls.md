# Controls and state model

This document is the canonical physical map for Ashlr Agent Board.

The shortcut and action map below applies in full while **Ashlr Layer** is
declared. The experimental **Hybrid Native** route applies the same map only to
the fourteen non-Agent controls; its six physical Agent keys remain Codex-owned.
**Codex Native** and **Not selected** unregister every Agent Board shortcut and
disable mapped actions. Software-only Agent-slot focus remains available from
the screen and never sends prompt or terminal input.

## Stable Agent-key geometry

The six Agent keys retain the same slot identity in every software lens. On the
physical Creator Micro 2, the rotary dial is at the left of the first row and
the planar toggle/joystick is at the right. The Agent keys form a two-plus-four
block between and below them:

```text
Physical row 1: DIAL | AG00 | AG01 | PLANAR TOGGLE / JOYSTICK
Physical row 2:        AG02 | AG03 | AG04 | AG05
```

This map identifies physical positions. In **Codex Native**, ChatGPT owns the
meaning and lighting of these keys; use the
[native acceptance procedure](setup.md#codex-native-restart-safe-handoff)
rather than the Ashlr shortcut table below.

For one reversible profile that keeps Codex Native in firmware layer 1 and the
shared Codex + Claude workflow in layer 2, use the guarded
[Dual Plane procedure](dual-plane-profile.md). The touch surface changes layers;
Agent Board's route declaration must be changed to match because it cannot
truthfully infer the active firmware layer.

The opt-in [Hybrid Native profile](hybrid-native-profile.md) instead keeps the
six layer-1 Agent cells on `KV_OAI_AG00`–`KV_OAI_AG05` while mapping every
action, joystick, and dial gesture below. Its generated two-layer profile
contains all twenty shared action definitions, but the hybrid first layer
references only the fourteen definitions for IDs `6`–`19`. This path is
source-tested and physically unaccepted.

| Physical ID | Desktop signal | Shortcut | Behavior |
| --- | --- | --- | --- |
| AG00 | Agent 1 | `Control+Option+Command+1` | Open slot 1 provider surface |
| AG01 | Agent 2 | `Control+Option+Command+2` | Open slot 2 provider surface |
| AG02 | Agent 3 | `Control+Option+Command+3` | Open slot 3 provider surface |
| AG03 | Agent 4 | `Control+Option+Command+4` | Open slot 4 provider surface |
| AG04 | Agent 5 | `Control+Option+Command+5` | Open slot 5 provider surface |
| AG05 | Agent 6 | `Control+Option+Command+6` | Open slot 6 provider surface |

When a slot is active, Codex opens ChatGPT and Claude Code opens cmux. This is application-level focus. No prompt, approval, or terminal input is submitted, and the app does not claim exact task or pane focus.

That six-slot shortcut behavior applies to Ashlr Layer, not Hybrid Native's six
physical Agent keys. On Hybrid Native layer 1, those keys remain Codex-only and
cannot select a Claude slot or exact cmux pane. The mixed screen queue remains
an observer and software-control surface.

That Ashlr Layer behavior is distinct from **Codex Native**. In Codex Native,
ChatGPT owns the six keys on firmware layer 1: one tap selects an assigned chat
without bringing ChatGPT forward, while two taps within 350 ms select it and
bring ChatGPT forward. An optional ChatGPT setting can make one tap focus the
app. Test an assigned, lit key for a chat other than the selected chat; an
unassigned, unlit, or already-selected slot may have no visible navigation
effect. Agent Board is passive on this route, so its twin does not animate from
the native HID press. Native ChatGPT behavior is not a Claude Code or cmux
contract.

## Black-cap state language

Opaque keycaps are the default design constraint. The screen is the complete state surface.

| Internal state | Visible label | Color | Meaning |
| --- | --- | --- | --- |
| `error` | Error | Red `#FF1744` | Failed or requires recovery |
| `needs_input` | Needs you | Amber `#FFAB00` | Human response or decision required |
| `working` | Working | Blue `#2979FF` | Agent is active |
| `unread` | Ready to review | Green `#00E676` | New output awaits review |
| `idle` | Idle | Purple `#7C4DFF` | Known session is inactive |
| `off` without provider | Available | Black | Slot is open |
| `off` with provider | Inactive | Black | Known provider session is inactive |

Provider is always shown as text and an icon. New `error` and `needs_input` transitions receive a polite screen-reader announcement. Color never carries the state by itself.

## Action switches and motion controls

| Physical ID | Desktop signal | Shortcut | Notes |
| --- | --- | --- | --- |
| ACT06 | Amplify | `Control+Option+Command+A` | Copy `$ashlr-delivery Amplify` |
| ACT07 | Verify | `Control+Option+Command+B` | Copy `$ashlr-delivery Verify` |
| ACT08 | Polish | `Control+Option+Command+C` | Copy `$ashlr-delivery Polish` |
| ACT09 | Advance | `Control+Option+Command+D` | Copy `$ashlr-delivery Advance` |
| ACT10 | Voice | `Control+Option+Command+E` | Return a local `voice_capture` intent; recording and permission remain provider/UI-owned |
| ACT11 | Guarded Continue | `Control+Option+Command+F` | Copy a bounded continuation prompt; never paste or submit |
| ACT12 | Attention | `Control+Option+Command+G` | Focus the highest-priority observed provider surface; ties use the lowest slot |
| JOY_UP | Joystick up | `Control+Option+Command+Up` | Lens-specific inspect/copy action |
| JOY_RIGHT | Joystick right | `Control+Option+Command+Right` | Next lens |
| JOY_DOWN | Joystick down | `Control+Option+Command+Down` | Lens-specific inspect/copy action |
| JOY_LEFT | Joystick left | `Control+Option+Command+Left` | Previous lens |
| ENC_CC | Dial left / counter-clockwise | `Control+Option+Command+Q` | Lower displayed reasoning depth |
| ENC_CW | Dial right / clockwise | `Control+Option+Command+W` | Raise displayed reasoning depth |
| ENC_CLK | Dial press | `Control+Option+Command+R` | Next lens |

ACT10 and ACT11 are separate physical switches on the two-button bottom row. Map and test each independently. ACT12 is the transparent bottom-right switch; its visible screen twin is the authoritative attention signal for opaque-cap setups.

Joystick up/down changes by lens; left/right always moves between lenses:

| Lens | Joystick up | Joystick down |
| --- | --- | --- |
| Attention | Fleet status | Copy verification brief |
| Pair | Copy planning brief | Copy verification brief |
| Fleet | Fleet direction | Fleet status |
| Proof | Recent commits | Git status |
| Recovery | Fleet doctor | Pause Fleet (hold required) |

The bottom-left circular surface is not a bindable key. A short tap changes the active layer. A three-second hold opens the firmware-owned connection selector for Bluetooth channels 1–3 and the fourth wired channel.

Work Louder Input serializes the encoder slots as `[clockwise,
counter-clockwise, press]`. That storage order is intentionally different from
the operator-facing Flight Check order of left, right, press.

## Lens action map

Agent keys and the seven daily workflow actions do not move across Attention, Pair, Fleet, and Proof. Recovery deliberately replaces the first four action keys with guarded operational controls.

| Lens | ACT06 | ACT07 | ACT08 | ACT09 | ACT10 | ACT11 | ACT12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Attention | Amplify | Verify | Polish | Advance | Voice | Continue | Attention |
| Pair | Amplify | Verify | Polish | Advance | Voice | Continue | Attention |
| Fleet | Amplify | Verify | Polish | Advance | Voice | Continue | Attention |
| Proof | Amplify | Verify | Polish | Advance | Voice | Continue | Attention |
| Recovery | Pause Fleet | Stop daemon | Fleet status | Fleet doctor | Voice | Continue | Attention |

The four delivery actions are project-local, provider-neutral clipboard
invocations documented in `.agents/skills/ashlr-delivery/SKILL.md`. They copy
instructions only; Codex or Claude Code still requires the operator to review,
paste, and submit them. Continue has the same clipboard-only boundary. Voice
returns an inert typed intent for a trusted UI; it does not start recording or
change microphone permission by itself. Attention excludes `off` slots and uses
`error > needs_input > working > unread > idle`, then lowest slot number. It may
foreground only the fixed provider app and never submits a prompt or terminal
input.

## Safety levels

- **Safe:** executes immediately. This includes fixed app opening, clipboard-only briefs, and bounded read-only inspection.
- **Confirm:** issues a single-use, 30-second authorization tied to the requesting window and selected workspace.
- **Hold:** requires a valid token and a continuous 1.6-second hold measured by the Electron main process. Fleet pause/resume and daemon stop belong here.

The registry intentionally contains no push, merge, deploy, publish, delete, spend, credential, or permission-approval executor.

## Source receipts

The Agent runway recognizes a `dev.wrkpad.hasp.state/v1` receipt. Fleet status is considered valid only when its required timestamp, daemon, queue, goal, and mission-brief fields have valid types. Invalid data is labeled invalid; it is not converted into authoritative zeroes.
