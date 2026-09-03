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
its observed provider. Exact Codex-task focus remains native-only. Exact cmux
pane focus is used only after a fresh locator and human-enabled cmux capability
pass validation; otherwise Agent Board safely foregrounds cmux and sends no
terminal input.

## Generate the candidate offline

Start from an exported, ordinary macOS Creator Micro 2 profile that contains no
protected `KV_OAI_*` layer. Keep that original export as rollback evidence.
From `wrkpad/app`, write a new output path:

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

1. Require a fresh strict-signature, publisher, and Gatekeeper check for Work
   Louder Input. If the installed bundle reports `known_resource_mutation`,
   replace it with a pristine official copy before profile work.
2. Open verified Input alone. Export every profile needed for rollback and
   record the current profile.
3. Choose **Import Profile** and select the generated candidate. Never use
   **Reset Settings**, edit the cache, or write `keymap.json` directly.
4. Inspect the candidate before activation. Confirm **Codex Native Recovery
   (UNOFFICIAL)** is visible position **1** and **Ashlr Daily** is position
   **2**. Confirm the profile name includes **UNOFFICIAL**.
5. Set that candidate current and wait for Input to finish without an update
   error. Export it again to a new file, fully quit Input, rerun the integrity
   check, and run `profile:check-dual` against the post-import export.
6. Leave Input quit. Declare **Codex Native** in Agent Board, establish layer 1,
   and perform the native physical acceptance. Without another layer change,
   short-tap the touch selector exactly once, declare **Ashlr Layer**, and begin
   the 20-gesture Flight Check within 30 seconds. The app requires that explicit
   transition from the just-proven layer-1 state; one blind tap from an unknown
   state is not accepted. A failed or interrupted Dual Plane run must be ended;
   re-establish layer 1 and repeat the one-tap transition before starting another
   receipt. The prior attestation is never reused for a restart. For the multi-layer profile, the read-only cache proves the exact
   Ashlr layer exists but cannot identify the selected firmware layer; the
   fresh attestation admits the test and the ordered physical receipt is the
   route evidence.
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
