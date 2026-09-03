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

1. In Agent Board Setup, require Work Louder Input to report a verified
   publisher, signature, and Gatekeeper result. If Input reports a resource
   mutation or any other integrity failure, stop and reinstall the current
   official Input build before profile work.
2. Open Input alone. Before changing anything, export every profile needed for
   rollback and record which profile is current. Keep those exports outside the
   repository.
3. Select the intended Creator Micro 2 profile. In the Layers menu choose
   **Import layer**, then select the generated or checked-in unofficial layer.
   Do not choose **Reset Settings**. If the profile already has six layers,
   stop; do not delete a protected or in-use layer to make room.
4. Export the resulting profile to a new file. Quit Input, then verify the
   export offline:

```bash
npm run profile:check-native -- POST_IMPORT-profile.json
```

5. If verification reports `mismatch`, Input rejected, stripped, duplicated,
   or changed a private keycode. Stop. Do not activate the candidate, patch the
   cache, write `keymap.json`, reset, or flash firmware. Reopen Input alone and
   restore the previously exported profile through Input's normal UI.
6. If verification reports `match`, reopen Input alone, set the intended
   profile current, select the imported layer, and wait for Input to finish.
   A success message proves only that Input accepted the request.
7. Fully quit Input. Keep every other board controller quit, or leave Agent
   Board open only after its passive **Codex Native** handoff succeeds. Open
   ChatGPT Desktop as the sole intended controller and keep the board on the
   white wired channel.

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
