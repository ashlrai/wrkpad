# Hybrid Native profile and acceptance contract

Status: **experimental source implementation; not physically accepted or
released**. The repository contains a bounded offline generator and strict
verifier, a `hybrid_native` shortcut-ownership policy, and a 14-signal Flight
Check evaluator. No checked-in evidence proves that Work Louder Input imported
the generated profile, that the board synchronized it, that ChatGPT consumed
the six native Agent keys, or that all fourteen ordinary shortcuts arrived from
the physical board. There is no signed or notarized public build.

## What the route is

Hybrid Native generates one profile with two firmware layers:

| Layer | Physical owner | Six Agent keys | Remaining fourteen signals |
| --- | --- | --- | --- |
| **1 · Ashlr Hybrid Native (UNOFFICIAL)** | Split | ChatGPT via `KV_OAI_AG00`–`KV_OAI_AG05` | Agent Board shortcuts |
| **2 · Ashlr Daily** | Agent Board | Agent Board shortcuts | Agent Board shortcuts |

Layer 1 is the experiment. It keeps the six physical Agent keys Codex-only
while assigning `ACT06`–`ACT12`, four joystick directions, and three dial
gestures to Agent Board. Layer 2 is the unchanged 20-shortcut Ashlr Daily
fallback for a provider-neutral Codex + Claude Code queue.

The on-screen runway can show a mixed queue on either route. That does not make
the layer-1 Agent keys provider-neutral: they cannot select a Claude Code slot.
Selecting a Claude slot on screen or using `ACT12` can only foreground cmux.
Exact Claude workspace or pane selection is unavailable, and Agent Board never
reads the terminal or sends keys, paste, commands, or prompts to it.

## Exact physical map

```text
DIAL  | AG00  | AG01  | JOYSTICK
      | AG02  | AG03  | AG04  | AG05
ACT06 | ACT07 | ACT08 | ACT09
TOUCH | ACT10 | ACT11 | ACT12 (transparent)
```

The bottom-left touch surface remains firmware-owned and is not one of the
twenty bindable signals.

### Layer 1: six native cells

| Physical control | Keycode | Owner |
| --- | --- | --- |
| `AG00` | `KV_OAI_AG00` | ChatGPT Agent key 1 |
| `AG01` | `KV_OAI_AG01` | ChatGPT Agent key 2 |
| `AG02` | `KV_OAI_AG02` | ChatGPT Agent key 3 |
| `AG03` | `KV_OAI_AG03` | ChatGPT Agent key 4 |
| `AG04` | `KV_OAI_AG04` | ChatGPT Agent key 5 |
| `AG05` | `KV_OAI_AG05` | ChatGPT Agent key 6 |

These private keycodes are an unofficial interoperability input. ChatGPT owns
task selection and native status lighting. Source generation does not prove
that the mixed layer is vendor-supported or consumed by ChatGPT.

### Layer 1: fourteen shortcut references

The generated profile contains **twenty action definitions total**, using the
same stable action IDs as Ashlr Daily. The Hybrid Native layer references only
IDs `6`–`19`; IDs `0`–`5` remain defined because the unchanged layer 2 uses
them.

| Action ID | Physical signal | Final key after `Control+Option+Command` | Agent Board behavior |
| --- | --- | --- | --- |
| `6` | `ACT06` | `A` | Copy the Amplify skill invocation for review |
| `7` | `ACT07` | `B` | Run allowlisted verification checks |
| `8` | `ACT08` | `C` | Copy the Polish skill invocation for review |
| `9` | `ACT09` | `D` | Copy the Advance skill invocation for review |
| `10` | `ACT10` | `E` | Return an inert local voice-capture intent |
| `11` | `ACT11` | `F` | Copy a bounded next-step brief for review |
| `12` | `ACT12` | `G` | Foreground the highest-priority observed provider app |
| `13` | `JOY_UP` | `Up` | Run the active lens's bounded up action |
| `14` | `JOY_RIGHT` | `Right` | Select the next Agent Board lens |
| `15` | `JOY_DOWN` | `Down` | Run the active lens's bounded down action |
| `16` | `JOY_LEFT` | `Left` | Select the previous Agent Board lens |
| `17` | `ENC_CC` | `Q` | Lower the displayed reasoning depth |
| `18` | `ENC_CW` | `W` | Raise the displayed reasoning depth |
| `19` | `ENC_CLK` | `R` | Select the next Agent Board lens |

Work Louder Input serializes the encoder as clockwise, counterclockwise, press,
so the generated array is `[KA_18, KA_17, KA_19]`. The radial joystick retains
the Ashlr Daily dead zones and references down, left, up, right as `KA_15`,
`KA_16`, `KA_13`, and `KA_14` in their corresponding sectors.

Amplify, Polish, Advance, and the next-step brief copy text only; they never
paste or submit it. Voice does not start recording. Attention never replies,
approves, or types into a provider.

## Evidence ledger

| Statement | Current evidence |
| --- | --- |
| Two-layer Hybrid Native artifact can be generated offline | Implemented and source-tested |
| Artifact has 20 exact action definitions and layer 1 references exactly 14 | Implemented and strict-verifier tested |
| `hybrid_native` owns only the 14 non-Agent shortcuts | Implemented and source-tested |
| Hybrid Flight Check expects 14 ordered signals and rejects Agent-key input | Implemented and source-tested |
| Input imports and preserves the mixed layer | Unknown; requires human import, post-import export, and strict verification |
| ChatGPT recognizes all six native Agent keys on layer 1 | Unknown; requires physical operator observation |
| Fourteen shortcuts arrive exactly once from the physical controls | Unknown; requires a passing physical receipt |
| Native RGB works for the six Agent keys | Unknown and not part of the 14+6 decision |
| A Claude Code slot opens its exact cmux pane | Not implemented; application foreground only |
| Signed/notarized binary or hosted public release exists | Not claimed |

## Generate and verify offline

Start from a fresh ordinary US/macOS Creator Micro 2 profile exported by a
currently verified Work Louder Input installation. It must contain no
`KV_OAI_*` values. From `app/`:

```bash
npm run profile:generate-hybrid -- ORDINARY-profile.json ashlr-hybrid-native.json
npm run profile:check-hybrid -- ashlr-hybrid-native.json
```

Generation writes a new mode-`0600` file without overwriting an existing path
and reports its SHA-256. It creates the exact profile name **Ashlr Hybrid Dual
Plane (UNOFFICIAL)** with layer 1 **Ashlr Hybrid Native (UNOFFICIAL)** and layer
2 **Ashlr Daily**. It clears inherited app links, smart actions,
multi-actions, and unknown fields while preserving only bounded lighting values.

The verifier requires the exact two-layer schema, names and order; six private
Agent keycodes; all twenty exact action definitions; the fourteen layer-1
shortcut references; encoder order; joystick sectors; and empty unsupported
groups. A `match` result proves only the file. Neither command opens Input,
imports or activates a profile, writes the device, changes firmware, or proves
physical behavior.

## Human import and rollback

Import and activation are persistent profile/device operations and remain
human-controlled.

1. Turn on Creator Micro 2 Pro, connect a data-capable USB-C cable, hold the
   bottom-left touch surface for three seconds, select the white wired channel,
   and let the selector close. The Base model has no wireless selector.
2. Fully quit ChatGPT, Agent Board, and other HID controllers. Open only a
   Work Louder Input copy that passes the strict publisher, signature,
   Gatekeeper, and resource-integrity checks.
3. Export every current profile needed for rollback and record the current
   profile and visible layer. Keep those exports outside the repository.
4. Fully quit Input. Run both commands above against a fresh ordinary export
   and retain the reported checksum.
5. Reopen verified Input alone. Choose **Import Profile**, select only the
   generated candidate, inspect both **UNOFFICIAL** and **Ashlr Daily** layers,
   then make the candidate current. Never use **Reset Settings**, edit Input's
   cache, or write `keymap.json` directly.
6. Wait for Input to finish. Stop on `update error, retry`; a success message is
   still not device acceptance.
7. Export the imported candidate to a new file, fully quit Input, recheck Input
   integrity, and run `profile:check-hybrid` against the post-import export.
8. On any failure, reopen a currently verified Input copy alone, restore the
   recorded rollback profile through Input's UI, wait for completion, fully
   quit Input, and reconcile integrity and the rollback export again.

Do not reset, flash firmware, weaken a signature check, or keep retrying a
mutated Input installation.

## Physical acceptance

Leave Input quit. Use exactly one reviewed Agent Board build with its Input
Monitoring grant, select the experimental `hybrid_native` route, and open
ChatGPT as the intended native owner. Require USB presence, the exact
post-import Hybrid profile receipt, one shortcut receiver, exactly fourteen
registered shortcuts, and the main-process action-suppression barrier.

### Fourteen shortcut signals

With actions suppressed, use only the physical board in this order:

1. `ACT06`, `ACT07`, `ACT08`, `ACT09`, `ACT10`, `ACT11`, `ACT12`;
2. joystick up, right, down, left, returning it to center each time; and
3. dial counterclockwise, clockwise, press.

Acceptance requires `14/14`, zero misroutes or duplicates, no registered
Agent-key shortcut, stable prerequisites, and a current private receipt. The
receipt must contain no prompt, transcript, task title, provider session ID,
terminal content, raw Input log, or local user path. Keyboard events can emit
the same accelerators, so a passing receipt also requires operator discipline;
it is not cryptographic proof that the board produced every event.

### Six Codex-native Agent keys

Separately, in ChatGPT Creator Micro settings require **Connected** and **Input
Monitoring: Granted**, choose a chat-following Agent-key mode, and assign six
harmless existing chats with distinguishable targets. For each physical Agent
key, start on another task, press once, and personally confirm only the assigned
task becomes selected. For at least one key, place another app in front and
double-tap within 350 milliseconds; confirm the assigned task is selected and
ChatGPT comes forward.

This is an operator attestation. It does not prove a raw HID report, unique
device identity, native RGB transport, provider approval, or prompt delivery.

Hybrid Native is locally accepted for one recorded configuration only when the
14-signal receipt and all six native observations are current and reconcile to
the same app build, profile fingerprint, board VID:PID class, firmware
observation, and acceptance window. Any route, profile, build, firmware,
permission, or controller-ownership change invalidates that result.

Source implementation, green CI, a generated file, Input import, a visible
layer name, ChatGPT's Connected label, or one half of the physical check does
not prove the next evidence layer. None establishes vendor support, another
desk, public GitHub Pages deployment, signed distribution, enterprise
readiness, government authorization, or user acceptance.
