# One board, two deliberate control planes

The recommended Creator Micro 2 layout keeps the same physical geometry while
separating two protocols that cannot truthfully share one slot identity:

| Firmware layer | Owner | Six Agent keys | Dial and joystick | Workflow row |
| --- | --- | --- | --- | --- |
| **1 · Codex Native** | ChatGPT Desktop | ChatGPT's assigned chats and native RGB | Native Codex controls | Native Codex actions |
| **2 · Ashlr Layer** | Agent Board | One mixed Codex + Claude Code six-slot queue | Ashlr lens and reasoning controls | Amplify, Verify, Polish, Advance, Voice, Continue, Attention |

Use a short tap on the bottom-left touch surface to advance the firmware layer;
a blind tap from an unknown starting layer does not identify the result.
Use a three-second hold only for the Bluetooth/wired communication selector.
The dial is the top-left rotary control; the planar joystick/toggle is on the
right.

This preserves Codex's supported device path instead of emulating it. On the
shared layer, provider hooks normalize Codex and Claude Code lifecycle events
into the same six stable slots. An occupied slot opens ChatGPT or cmux based on
its observed provider. Exact Codex-task focus remains native-only. The
source-tested exact cmux-focus substrate is unreachable in the current installed
app because locator capture, authorization issuance, and credential enrollment
are not implemented. Current Claude slots safely foreground cmux at the
application level and send no terminal input.

## Prepare a trusted source export

1. Turn on Creator Micro 2 Pro, attach a data-capable USB-C cable, hold the
   bottom-left touch surface for three seconds, select the fourth communication
   channel with white underglow, and let the selector exit.
2. Run `npm run doctor` from `wrkpad/app`. Before profile work, require the Work
   Louder Input installation check to pass strict publisher, signature,
   Gatekeeper, and resource-integrity validation. If it reports
   `known_resource_mutation`, fully quit Input and replace it with a pristine
   official copy first.
3. Open that verified Input copy alone. Export every current profile needed for
   rollback, record the current profile and layer, and then export an ordinary
   macOS Creator Micro 2 source profile containing no protected `KV_OAI_*`
   layer. Fully quit Input.

## Generate the candidate offline

Keep the ordinary source export unchanged as rollback evidence. From
`wrkpad/app`, write a new output path:

```bash
npm run profile:generate-dual -- ORDINARY-profile.json ashlr-dual-plane.json
npm run profile:check-dual -- ashlr-dual-plane.json
```

Generation constructs a new, bounded profile with exactly two layers. It
copies only the source layer's validated lighting values, refuses a protected
native source, writes a new mode-`0600` file, and never opens Input, changes
Input's cache, writes HID, or changes the device. Verification requires the
exact native layout in position 1, the exact Ashlr layout in position 2, and
all 20 expected shortcut actions. A `match` result proves only the file.

## Human import and acceptance

1. Re-run `npm run doctor` and require the verified Input result to remain
   current.
2. Open verified Input alone and choose **Import Profile** for the generated
   candidate. Never use
   **Reset Settings**, edit the cache, or write `keymap.json` directly.
3. Inspect the candidate before activation. Confirm **Codex Native Recovery
   (UNOFFICIAL)** is visible position **1** and **Ashlr Daily** is position
   **2**. Confirm the profile name includes **UNOFFICIAL**.
4. Set that candidate current and wait for Input to finish without an update
   error. Export it again to a new file, fully quit Input, rerun the integrity
   check, and run `profile:check-dual` against the post-import export.
5. Leave Input quit. Declare **Codex Native** in Agent Board. Establish layer 1
   by testing a harmless assigned Codex Agent Key and personally observing the
   expected native response. If that response is absent, short-tap once and
   retest; the generated candidate has exactly two layers. Perform the remaining
   native physical acceptance only after the visible native response succeeds.
6. Without another layer change, short-tap the touch selector exactly once,
   declare **Ashlr Layer**, and check the operator self-attestation within 30
   seconds before starting the 20-gesture Flight Check. The checkbox records
   what the operator reports doing; Agent Board does not observe the touch,
   selected firmware layer, or bind this assertion to a native HID receipt. A
   failed or interrupted run must be ended; personally re-establish layer 1 and
   repeat the one-tap transition before supplying a new self-attestation. The
   previous attestation is never reused for a restart. The read-only cache proves
   only that the exact Ashlr layer exists; the ordered physical Flight Check is
   the route evidence.
7. If either acceptance fails, stop. Reopen a currently verified Input copy
   alone, restore the recorded rollback profile through Input's UI, quit Input,
   and reconcile integrity and device state again.

Agent Board cannot reliably observe the firmware's selected layer, so the
route declaration is an operator-visible expectation, not automatic detection.
Do not use Work Louder AppSense for automatic switching while qualifying Codex
Native: Input must remain quit so ChatGPT is the sole intended HID protocol
owner. A future verified device-side layer receipt may remove this manual step;
process focus alone is not enough.

## Stable muscle memory

The six physical positions never move, but their identities are deliberately
different: ChatGPT owns AG00–AG05 on layer 1; HASP owns the mixed queue on layer
2. The shared action row remains stable across every Ashlr software lens. The
transparent ACT12 key is Attention: error, needs input, working, unread, then
idle, with the lowest slot number breaking ties. The on-screen black-cap legend
remains authoritative until physical lighting is independently qualified.
