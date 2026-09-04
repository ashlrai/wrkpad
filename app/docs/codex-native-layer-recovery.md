# Recover the Codex Native layer without Reset Settings

Use this procedure only when ChatGPT reports **Connection: Connected** and
**Input Monitoring: Granted**, but every physical Creator Micro 2 control is
silent and a backed-up Input export does not contain `KV_OAI_*` bindings. It
prepares a separate recovery layer; it does not reset existing profiles.

> [!CAUTION]
> This is an **unofficial interoperability procedure**. Work Louder and OpenAI
> document the native behavior, but neither publishes or guarantees the raw
> Input JSON import schema used here. Importing is a persistent board
> configuration change performed only by the user in Work Louder Input. Source
> generation, tests, or a successful import do not prove device synchronization
> or physical Codex behavior.

## What the artifact contains

The checked-in
[`UNOFFICIAL-creator-micro-2-codex-native-recovery-layer.json`](../profiles/UNOFFICIAL-creator-micro-2-codex-native-recovery-layer.json)
uses Input's layer-import envelope for a US Creator Micro 2 on macOS (`os: 0`):

- six Agent keys, `KV_OAI_AG00` through `KV_OAI_AG05`;
- seven action keys, `KV_OAI_ACT06` through `KV_OAI_ACT12`;
- dial counterclockwise, clockwise, and press as `KV_OAI_ENC_CC`,
  `KV_OAI_ENC_CW`, and `KV_OAI_ENC_CLK`;
- joystick mode `{ "type": "VENDOR", "sectors": [] }`.

The `2 + 4 + 4 + 3` switch geometry is exact. This is not the on-device
`keymap.json` format, and it must never be written with a raw HID or device
filesystem tool.

## Interpret Input's layer display correctly

In Work Louder Input 0.18.4, the black numeric badge is a one-based editor
position. A black **1** beside **Ashlr Daily** means that the editor is showing
the first layer in that profile. It does not identify the layer's bindings,
prove that the physical board selected it, or prove that the current editor
state synchronized to the device.

The locally inspected Input 0.18.4 import path treats this artifact as a
single-layer import. Input replaces the artifact's provisional `layer.id` with
the next available ID, appends the layer to the selected profile, and selects
the new last editor position. It does not replace the existing layer whose ID
is `0`. For example, importing into a one-layer profile leaves its ordinary
layer at badge **1** and displays the imported layer at badge **2**.

OpenAI documents that ChatGPT uses layer 1. The recovery procedure therefore
requires the operator to move the imported native layer to the first visible
position while retaining the ordinary layer behind it. This append and
renumber behavior is an observation of Input 0.18.4, not a vendor-guaranteed
import contract. If another verified Input release behaves differently, stop
before activation and revise the reviewed procedure for that exact version.

The layout is corroborated by the independent, MIT-licensed
[micro2-agent-keys default layout](https://github.com/okko/micro2-agent-keys#default-layout),
[work-louder-oai factory keymap example](https://github.com/boopdotpng/work-louder-oai/blob/main/examples/factory-keymap.json),
and [codex-micro-status Input layer export](https://github.com/Tomatio13/codex-micro-status/blob/main/Layer-1-layer.json).
These projects are reverse-engineered community sources, not vendor
documentation. The macOS `os: 0` value is separately corroborated by the
reverse-engineered [Input 0.18.0 configuration model](https://github.com/MarlinDiary/worklouder-input-cli/blob/main/docs/configuration-reference.md).
The official [Codex Micro guide](https://learn.chatgpt.com/docs/features/codex-micro)
defines the expected controls and says ChatGPT uses layer 1. Work Louder's
official [setup guide](https://worklouder.cc/openai-micro-setup) documents Input
and its destructive **Reset Settings** path, but not this import schema.

## Generate and inspect offline

Run from `wrkpad/app`. The output path must not already exist:

```bash
npm run profile:generate-native -- codex-native-recovery-layer.json
npm run profile:check-native -- codex-native-recovery-layer.json
```

Generation writes a new mode-`0600` file and prints its SHA-256. It does not
open Input, edit Input's cache, import a layer, select a profile, send HID, or
write the board. `profile:check-native` validates only the bounded JSON file; a
`match` result is not runtime acceptance.

## Import with a rollback

1. Fully quit Input and refresh Agent Board's integrity check. Require the
   current installed copy to report a verified publisher, strict signature,
   and Gatekeeper result immediately before profile work. On the tested desk,
   a fresh direct signature check currently fails on the modified sealed
   `window-info-retriever.scpt` resource even though an earlier renderer status
   reported verification. The fresh direct result governs; do not import from
   the currently mutated copy.
2. If verification fails or reports `known_resource_mutation`, replace Input
   with a pristine copy from Work Louder's official distribution. Do not add a
   signature exception, ad-hoc sign the app, delete its Application Support
   data, or bypass Gatekeeper. Recheck publisher, strict signature, and
   Gatekeeper while Input is still closed.
3. Open the verified Input copy alone. Before changing anything, export every
   profile needed for rollback and record which profile is current. Keep those
   exports outside the repository.
4. Create a new candidate profile for native recovery. Do not repurpose, delete,
   or transform **Ashlr Agent Board Corrected**, **Ashlr Daily**, or another
   working profile or layer.
5. In the candidate profile's Layers menu choose **Import layer**, then select
   the generated or checked-in unofficial layer. Do not choose **Import
   profile** or **Reset Settings**. If the candidate already has six layers,
   stop; do not delete a protected or in-use layer to make room.
6. Confirm that Input appended **Codex Native Recovery (UNOFFICIAL)** as the
   last visible layer. Move that layer to the first visible position, badge
   **1**, and retain the candidate's ordinary layer in the next position. Wait
   for **layout updated**. If Input reports **update error, retry**, stop and do
   not activate the candidate.
7. Export the candidate profile to a new file, then fully quit Input. Because
   the observed sealed resource changed while Input was running, treat
   launch-time self-mutation as possible even though causality is not proven.
   Repeat the direct integrity check. If verification changed, stop and restore
   a pristine official copy before opening Input again.
8. Verify the exported candidate offline:

```bash
npm run profile:check-native -- POST_IMPORT-profile.json
```

   A `match` result proves that exactly one bounded native layout exists
   somewhere in the export. It does not prove layer order. Separately inspect
   the export and confirm that `profile.layers[0]` is **Codex Native Recovery
   (UNOFFICIAL)** with the exact `KV_OAI_*` layout. Also confirm in Input that
   the same layer is still the first visible layer; a black **1** alone is not
   content evidence.
9. If verification reports `mismatch`, Input rejected, stripped, duplicated,
   or changed a private keycode. Stop. Do not activate the candidate, patch the
   cache, write `keymap.json`, reset, or flash firmware. Reopen Input alone and
   restore the previously exported profile through Input's normal UI.
10. If both checks pass and Input still verifies pristine, reopen Input alone,
   set the candidate profile current, confirm the native layer remains first,
   and wait for Input to finish. A success message proves only that Input
   accepted the request; it does not prove device synchronization.
11. Fully quit Input and repeat the integrity check. If verification changes,
   stop and reinstall the official copy before any future Input-controlled
   operation. Keep every other board controller quit, or leave Agent
   Board open only after its passive **Codex Native** handoff succeeds. Open
   ChatGPT Desktop as the sole intended controller and keep the board on the
   white wired channel.

Rollback does not require deleting the candidate. Open a currently verified
Input copy alone, set the previously recorded profile current, wait for Input
to finish, and fully quit it. Then reconcile Input integrity and device state
again.

## Physically verify Codex

Require all of these observations before calling the recovery accepted:

1. ChatGPT Creator Micro settings still show **Connected** and **Granted**.
2. Long-pressing the dial opens the Creator Micro settings.
3. From a normal composer, one dial detent changes reasoning depth in the
   expected direction. Turning it while the settings page is already open is
   not this test.
4. Double-tapping an assigned Agent key for a different chat within 350 ms
   foregrounds ChatGPT and selects that chat; a second assigned key selects its
   own chat.
5. One harmless joystick direction produces the action configured in ChatGPT.
6. One harmless action key produces the action configured in ChatGPT.

Record the observations in the Codex Native handoff. A matching JSON file,
Input import, lighting change, or `Connected` label alone does not satisfy this
gate. If every control remains silent, restore the exported rollback profile
in Input and escalate with the generated SHA-256, Input version, firmware
version, and sanitized doctor reason. Do not use Reset Settings as the next
diagnostic step.
