# Controls and state model

This document is the canonical physical map for Ashlr Agent Board.

## Stable Agent-key geometry

The six Agent keys retain the same slot identity in every software lens.

```text
Physical row 1: STICK | AG00 | AG01 | DIAL
Physical row 2:         AG02 | AG03 | AG04 | AG05
```

| Physical ID | Desktop signal | Shortcut | Behavior |
| --- | --- | --- | --- |
| AG00 | Agent 1 | `Control+Option+Command+1` | Open slot 1 provider surface |
| AG01 | Agent 2 | `Control+Option+Command+2` | Open slot 2 provider surface |
| AG02 | Agent 3 | `Control+Option+Command+3` | Open slot 3 provider surface |
| AG03 | Agent 4 | `Control+Option+Command+4` | Open slot 4 provider surface |
| AG04 | Agent 5 | `Control+Option+Command+5` | Open slot 5 provider surface |
| AG05 | Agent 6 | `Control+Option+Command+6` | Open slot 6 provider surface |

When a slot is active, Codex opens ChatGPT and Claude Code opens cmux. This is application-level focus. No prompt, approval, or terminal input is submitted, and the app does not claim exact task or pane focus.

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
| ACT06 | Action 1 | `Control+Option+Command+A` | Lens-specific |
| ACT07 | Action 2 | `Control+Option+Command+B` | Lens-specific |
| ACT08 | Action 3 | `Control+Option+Command+C` | Lens-specific |
| ACT09 | Action 4 | `Control+Option+Command+D` | Lens-specific |
| ACT10 | Mic left switch | `Control+Option+Command+E` | Daily Mic action |
| ACT11 | Mic right switch | `Control+Option+Command+F` | `None` in the daily Input layer |
| ACT12 | Action 7 | `Control+Option+Command+G` | Lens-specific |
| JOY_UP | Joystick up | `Control+Option+Command+Up` | Lens-specific inspect/copy action |
| JOY_RIGHT | Joystick right | `Control+Option+Command+Right` | Next lens |
| JOY_DOWN | Joystick down | `Control+Option+Command+Down` | Lens-specific inspect/copy action |
| JOY_LEFT | Joystick left | `Control+Option+Command+Left` | Previous lens |
| ENC_CC | Dial left / counter-clockwise | `Control+Option+Command+Q` | Lower displayed reasoning depth |
| ENC_CW | Dial right / clockwise | `Control+Option+Command+W` | Raise displayed reasoning depth |
| ENC_CLK | Dial press | `Control+Option+Command+R` | Next lens |

The wide Mic cap spans ACT10 and ACT11. In the daily profile, map the desired Mic shortcut to ACT10 and set ACT11 to `None`. Map both only on a disposable diagnostic layer used by the 20-signal Flight Check.

The bottom-left circular surface is not a bindable key. A short tap changes the active layer. A three-second hold opens the firmware-owned connection selector for Bluetooth channels 1–3 and the fourth wired channel.

Work Louder Input serializes the encoder slots as `[clockwise,
counter-clockwise, press]`. That storage order is intentionally different from
the operator-facing Flight Check order of left, right, press.

## Lens action map

Agent keys do not move. Only ACT06–ACT09, ACT12, joystick up/down, and the lens controls vary.

| Lens | ACT06 | ACT07 | ACT08 | ACT09 | ACT12 | Joystick up | Joystick down |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Attention | Open Codex workspace | Open Claude Desktop | Copy plan brief | Copy review brief | Ashlr command center | Fleet status | Copy verification brief |
| Pair | Git status | Diff summary | Copy verification brief | Run tests | Ashlr command center | Copy plan brief | Copy verification brief |
| Fleet | Git status | Diff summary | Copy plan brief | Copy review brief | Pause Fleet | Fleet direction | Fleet status |
| Proof | Tool health | Fleet doctor | Open Codex workspace | Start guarded Codex | Copy verification brief | Recent commits | Git status |
| Recovery | Pause Fleet | Stop daemon | Fleet status | Fleet doctor | Tool health | Fleet doctor | Pause Fleet |

The Mic cap has the same one-time configuration guidance in every lens.

## Safety levels

- **Safe:** executes immediately. This includes fixed app opening, clipboard-only briefs, and bounded read-only inspection.
- **Confirm:** issues a single-use, 30-second authorization tied to the requesting window and selected workspace.
- **Hold:** requires a valid token and a continuous 1.6-second hold measured by the Electron main process. Fleet pause/resume and daemon stop belong here.

The registry intentionally contains no push, merge, deploy, publish, delete, spend, credential, or permission-approval executor.

## Source receipts

The Agent runway recognizes a `dev.wrkpad.hasp.state/v1` receipt. Fleet status is considered valid only when its required timestamp, daemon, queue, goal, and mission-brief fields have valid types. Invalid data is labeled invalid; it is not converted into authoritative zeroes.
