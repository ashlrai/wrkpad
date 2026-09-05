# Setup and Flight Check

Setup proves six different things: USB presence, declared board route, native
Codex firmware compatibility, macOS authority, shortcut configuration, and
physical routing. Do not treat one as proof of the others.

Run desktop commands from the app directory:

```bash
cd wrkpad/app
```

## 1. Connect the board

Connect the Creator Micro 2 directly over USB-C for commissioning. A Bluetooth
keyboard and Apple trackpad can remain connected; they use separate device
paths and are not the cause of a missing Creator Micro USB device.

For a Creator Micro 2 Pro, confirm the board is in wired mode using the current
official [Creator Micro 2 setup](https://worklouder.cc/micro-setup):

1. Hold the bottom-left touch sensor for three seconds to enter communication
   mode. The underglow turns blue for Bluetooth Low Energy mode.
2. Tap the same sensor through Bluetooth channels 1, 2, and 3. The fourth tap
   selects **WIRED** mode; the underglow turns white.
3. Stop touching the sensor and let communication mode exit after its five
   seconds of inactivity. The Base model has no wireless selection; plug it in.

Outside communication mode, a short tap on this sensor changes the active
layer. Do not tap it during Flight Check. White underglow proves only that the
board firmware selected wired mode. It does not prove that macOS enumerated the
USB device, that either app connected, that Input synchronized a profile, or
that a physical gesture was accepted. Work Louder's general guide says inserting
USB switches the Pro to wired mode, while the current
[Codex Micro guide](https://learn.chatgpt.com/docs/features/codex-micro) says it
only charges while Bluetooth remains selected. For Codex, do not rely on cable
insertion: explicitly select the white wired channel.

```bash
npm run doctor
```

Expected USB result: `Creator Micro 2 USB: Work Louder 303A:8298` on the desk-verified unit. The read-only doctor also recognizes `303A:8297` as a candidate and labels it accordingly; neither identity authorizes writes. Prerequisites are route-specific: **Ashlr Layer** requires the board and a verified Work Louder Input installation, while **Codex Native** requires the board and ChatGPT Desktop. Input integrity is advisory for a read-only native retry because Input must remain quit, but it becomes a blocking gate again before any later Input-controlled profile or firmware operation. Codex CLI, Claude Code, and Ashlr Hub remain optional integrations; their absence produces warnings rather than satisfying or failing either hardware route.

The doctor is read-only and cannot grant permissions or change board configuration. `npm run doctor -- --json` includes `manualChecks`, route-specific `modeGuidance`, and a prioritized `nextAction`. It inspects only a bounded tail of recent Codex Desktop logs and projects a reason code; raw log lines and paths never reach the renderer. Passing required checks does not prove native Codex connection, Input Monitoring, the active Input layer, or the physical Flight Check. If USB is absent, use [troubleshooting](troubleshooting.md#usb-device-is-not-detected).

If ChatGPT later shows **Connected** and **Granted** while every native control
remains silent, do not reset or reflash from that symptom. Use the separate,
manual [unofficial Codex Native layer recovery](codex-native-layer-recovery.md)
only after exporting rollback profiles and verifying the Input installation.

## 2. Declare the board route

Agent Board stores one local expectation:

- **Codex Native:** Codex is expected to handle vendor HID events and lighting.
- **Ashlr Layer:** Work Louder Input is expected to emit the canonical desktop
  shortcuts for Codex, Claude Code/cmux, and Ashlr Fleet.
- **Hybrid Native (experimental):** the six physical Agent keys are expected to
  remain Codex-owned while Agent Board receives only the fourteen action,
  joystick, and dial shortcuts from the mixed first layer.
- **Not selected:** no physical route is inferred.

This is labeled **Declared here — not detected**. Changing it writes the private
Agent Board settings file and changes only Agent Board's runtime global-shortcut
ownership: Codex Native and Not selected release the known shortcuts, Ashlr
Layer may register all twenty, and Hybrid Native may register only the fourteen
non-Agent shortcuts after its ownership checks pass. It does not
change the board, firmware, Input or Codex configuration, another process,
hooks, or `wrkpad` occupancy.

Hybrid Native is implemented as an opt-in source experiment, not an accepted
desk configuration. Generate, import, roll back, and test it only through the
[Hybrid Native evidence contract](hybrid-native-profile.md). Its two-layer
artifact contains twenty action definitions total; the mixed first layer
references fourteen and leaves all six Agent keys Codex-only.

### Ashlr Layer local commissioner

When **Ashlr Layer** is declared, Setup opens a local commissioner above the
long-form checklist. Use it as the first diagnostic view:

1. Read the highlighted proof gate. The runway keeps exact USB identity, Input
   installation trust, receiver/permission evidence, rollback, candidate, and
   physical acceptance separate.
2. Select **Run checks again**, **Detect my board**, or **Verify local
   environment** to refresh bounded read-only evidence. These controls do not
   register a new shortcut, change Input, request permission, or open the
   device.
3. Expand **Evidence by proof level** when a gate is unclear. The state and
   text label are authoritative; color is only redundant emphasis.
4. Select **Prepare commissioning plan** only after reviewing the named
   prerequisites. The app collects two snapshots, rejects drift, and writes a
   private mode-`0600` journal only when the evidence and plan validate. The
   current plan expires and contains `writesAuthorized: false` because no live
   executor is configured.
5. Inspect the implemented commissioner state from a stable `wrkpad` install:

```bash
wrkpad commissioner status --json
```

   Require `executor=not_configured`, `mutation_available=false`, and
   `firmware_writes_available=false` to remain truthful until an embedded
   executor ships. A capable external computer-use agent may still operate only
   visible Input UI under one-time enrollment and a fresh content-bound plan;
   there is no headless apply command in the current source.
6. If **Open agent handoff** appears, let an enrolled Codex or Claude agent follow the visible recovery card against the bound candidate and rollback artifact.
   That handoff may validate and reveal a new offline artifact. A capable
   external agent may perform the visible import, activation, relaunch, and
   readback; otherwise the user can follow the same bounded handoff.
7. Return to Setup and start a fresh Flight Check. Use only the intended board
   during the run. No cached profile, prepared plan, or synthetic shortcut is
   acceptance; macOS still cannot cryptographically identify which keyboard
   emitted a global shortcut.

The current source implementation deliberately does not create the external
Work Louder Input backup. When the user selects an ordinary export to
create a corrected offline artifact, the private recovery receipt records the
source path and SHA-256; the commissioner reopens that exact bounded file and
requires the bytes to match before it marks the source-backup gate protected.
This does not prove the export is the current device state or a complete
rollback. Until that receipt exists, the runway remains at **Source backup ·
Action required**.
It also leaves physical acceptance in the existing Flight Check system rather
than promoting its journal from cache state. This is a visible implementation
boundary, not a request to bypass the gate.

The [canonical commissioning authority](../../docs/commissioner-architecture.md#authority-model)
defines the next supported automation layer: one-time enrollment, a one-use
plan bound to exact app/device/artifact content, automatic vendor-UI
before-state backup, visible UI import/activation, cold-relaunch checksum and
semantic readback, and one bounded rollback. If the backup cannot be saved or
reconciled, no write is allowed. Enrollment never permits TCC changes, direct
cache/private-IPC/HID writes, reset, deletion, or firmware. Physical Flight
Check still requires real board emissions.

The local commissioner applies only to `ashlr_layer`. Codex Native keeps the
separate handoff below, and Hybrid Native keeps its own 14+6 acceptance
contract. Never use an Ashlr Layer commissioner result as proof of native
Codex keys, native RGB, exact Codex task focus, or exact Claude/cmux pane focus.

### Codex Native restart-safe handoff

The Codex Native route has its own Setup flight plan. It does not require Work
Louder Input, an Input profile, Input Monitoring for Agent Board, or Agent
Board shortcut ownership. Those belong to the separate Ashlr Layer route.

Use **Prepare handoff** before the controller-isolation restart:

1. Require USB presence, a declared **Codex Native** route, and bounded
   version/build metadata from fixed `/Applications/ChatGPT.app`. This does not
   verify its signature, publisher, Gatekeeper result, or the running process.
2. Select **Prepare handoff**. Agent Board saves a private mode-`0600` receipt
   containing only the route, board VID:PID, ChatGPT Desktop version/build,
   preparation time, and seven false observation flags. Preparation also fails
   closed unless Electron confirms that none of Agent Board's 20 known shortcut
   accelerators remains registered.
3. Leave Agent Board open with **Codex Native** declared. In this route it
   unregisters all 20 Ashlr shortcuts, clears Flight Check and pending approval
   state, and its device path performs only bounded read-only observation; it
   does not open a board HID handle or write the device. Agent Board may remain
   open only after **Prepare handoff** succeeds. Otherwise, quit it before the
   retry. Quit Work Louder Input with Command-Q.
4. Command-Q ChatGPT Desktop, reopen it, and wait for native initialization. In
   Codex Settings, open **Creator Micro** and inspect the connection and displayed
   Input Monitoring states. Agent Board checks its bounded native evidence
   periodically, targeting five-second intervals while the app is active and
   the prepared handoff is waiting. macOS or Electron may throttle background
   timers, so **Refresh now** is the authoritative manual check; neither path
   records an operator observation.
   A fresh ordered `v.oai.rgbcfg` → `v.oai.thstatus` → HID notification →
   radial notification sequence may advance the ladder to **Initialization
   inferred**. It does not complete the Settings or physical checks.
5. Keep the board on the explicitly selected white wired channel and establish
   firmware layer 1, which the current official
   [Codex Micro guide](https://learn.chatgpt.com/docs/features/codex-micro)
   assigns to ChatGPT. A short tap advances the layer; it does not identify or
   select layer 1. Treat only the harmless visible native response in step 7 as
   operator evidence, and do not touch the layer selector after that response.
6. Isolate Agent-key navigation from commands before testing it. In ChatGPT's
   Creator Micro settings, choose a chat-following Agent-key mode rather than a
   Custom shortcut, action, or skill, and make at least two harmless existing
   chats available to assigned, lit slots. A pinned ordering is the most
   deterministic. Use the sidebar only to establish which chat is selected;
   do not submit a prompt or invoke an approval for this check.
7. Exercise the six center Agent keys using their physical two-plus-four
   geometry: AG00 and AG01 sit between the left rotary dial and right planar
   toggle/joystick; AG02 through AG05 are directly below. Choose a lit key
   assigned to a chat other than the current chat, put another application in
   front, and double-tap the key within 350 ms. ChatGPT should select that chat
   and come to the foreground. With ChatGPT visible, single-tap a different
   assigned key; a single tap selects its chat without bringing ChatGPT forward.
   Pressing the already selected chat can have no visible navigation effect,
   and an unassigned or unlit slot does not prove failure. Leave an unassigned
   slot pending rather than claiming it passed.
8. Exercise the left rotary dial, right planar toggle/joystick, the five safely
   isolated native action switches ACT06 through ACT09 plus transparent ACT12,
   separate ACT10 and ACT11 bottom-row keys, and black-cap lighting. Do not press an
   approval, rejection, or other consequential native command against live work
   merely to complete this receipt. Leave that group pending when a harmless
   context cannot be established.
9. Keep Agent Board passive throughout the native check. After a prepared
   handoff it owns no Ashlr global shortcuts and opens no board HID handle, so a
   physical press will not animate its board twin or prove a native event there.
   Judge the result in ChatGPT and on the physical board, then record only the
   observation you personally made.
10. **Accept operator attestation** becomes available only when all seven groups
   are checked and the initialization is fresh, ordered, newer than the
   preparation, and bound to the same VID:PID class and fixed-path ChatGPT
   metadata.

#### Per-control native recovery report

Setup also provides a separate **Prove what the key actually did** report for
diagnosing a connected-but-inactive native board. Record ChatGPT Settings as
connected/granted, failed/ungranted, or not checked, then record a bounded result
for the left dial, right planar toggle/joystick, each of AG00–AG05, each of
ACT06–ACT12, and lighting. The UI calls these 16 control groups because the
dial's three motions and joystick's four directions are grouped; this is not the
20-gesture Ashlr Layer Flight Check.

`no_response` or `unexpected_target` produces a reported failure.
`not_configured` and `skipped` keep the report incomplete. Only
connected/granted plus an observed response for all 16 groups produces the
`operator_accepted` label. The private mode-`0600` receipt is bound to the
current declared route, VID:PID class, and ChatGPT version/build and contains no
task title, identifier, prompt, transcript, path, or raw log. It is a human
report, not HID proof, and it does not replace the restart-safe initialization
handoff above or the Ashlr Layer Flight Check below.

Acceptance is saved in two fail-closed phases. If Agent Board closes or local
storage stops between staging and final promotion, Setup shows **Acceptance
interrupted before completion**. That durable intermediate receipt is explicitly
not accepted and cannot become accepted merely because the prior context later
returns. Select **Start fresh handoff** once to replace it with a clean
preparation, or select **Clear handoff** to remove it. While preparing,
refreshing, accepting, or clearing, the initiating control and a visible live
status name that exact operation; the other handoff controls remain disabled.

The saved result is an operator attestation, not a cryptographic device proof.
It contains no prompt, task title, session identifier, raw log, diagnostic
detail, or local path. Any route, VID:PID class, Desktop metadata, or live
initialization mismatch invalidates the projected acceptance. **Clear handoff**
removes only this local receipt; it never changes the board, Codex, Input, or
firmware. The receipt survives quitting Agent Board; it does not uniquely
identify one board, prove the running ChatGPT binary, or prove a process restart.

## 3. Verify Work Louder Input

Install Work Louder Input only from the official
[Work Louder Input download](https://worklouder.cc/input/). Input owns board
profiles, layers, shortcuts, firmware updates, and its radial menu. Agent Board
does not write firmware or Input's configuration database.

In Setup, require **Input … · publisher, signature, and Gatekeeper verified**
before importing a profile, opening an updater, or relying on Input for Flight
Check. The diagnostic returns a sanitized status and optional bounded version;
it does not expose the app path, signing output, or publisher identifier. An
installed app with `invalid metadata`, `publisher unrecognized`, `invalid
signature`, `known resource mutation`, `Gatekeeper rejected`, `unsafe`,
`multiple installations`, or `probe unavailable` is not a verified controller.
The fixed-path probe uses Work Louder's official lowercase `input.app` bundle
name; it does not scan Applications folders or relax canonical-path checks.

On the tested desk, a fresh official Input 0.18.4 copy passed publisher, strict
signature, and Gatekeeper checks before the approved September 2 firmware
update. After that session, the same single sealed `window-info` helper changed
again. The installed copy is now `known resource mutation` and unverified for
another Input-controlled operation. This does not invalidate native Codex while
Input is closed. See the canonical
[post-flash evidence record](../../docs/creator-micro-2-post-flash-2026-09-02.md).
If Setup reports this result, preserve a stopped-state backup, replace Input
from the official release, and require fresh verification before another
profile, device-file, or firmware mutation.

If verification does not pass, stop configuration and firmware work. Fully quit
Input manually, download a fresh installer from the official page, replace the
unverified copy using Finder, and refresh Setup before reopening Input. Do not
have an agent delete an application, bypass Gatekeeper, alter quarantine
metadata, or kill a process. If both `/Applications` and the user's Applications
folder contain Input, resolve the duplicate manually before continuing. Reinstallation
does not prove profile state, Input Monitoring, device sync, or physical
acceptance.

Do not use QMK/VIA instructions intended for the legacy Creator Micro v1.

If Input offers a firmware update during Ashlr-layer commissioning, defer it.
Firmware availability is not firmware qualification, and changing firmware
invalidates the configuration baseline. Do not enter the updater at all until
Setup reports the signed Input installation as verified.

For **Codex Native**, a fresh `firmware_rpc_missing` result means USB and HID
worked but the board returned RPC 404 for `v.oai.rgbcfg`. That was the tested
desk's pre-flash state, not its current state. On September 2 the operator
updated that unit to `0.6.2`; the board then returned success for
`v.oai.rgbcfg` and `v.oai.thstatus`. Native Codex consumption and physical
acceptance remain pending, so do not reflash from that historical 404. See the
[post-flash evidence](../../docs/creator-micro-2-post-flash-2026-09-02.md).

As verified on September 1, 2026, Work Louder marks [Creator Micro v2 firmware
v0.6.2](https://github.com/worklouder/cm-v2-fw-releases/releases/tag/v0.6.2)
as its latest release, and its release asset contains both required Codex RPC
names. For any other device, that release remains a pinned qualification input,
not authorization to flash or proof of compatibility. Updating is an explicit
vendor operation and the post-update checks below remain the acceptance gate:

The reviewed candidate asset is `firmware_0.6.2_merged.bin`, 2,086,848 bytes,
SHA-256
`1edbcdec89d049b3bb0691ba58b7de332e4612fef870354e1f5027b8849c6fb1`.
These values were verified on September 1, 2026. Stop if Input offers a
different tag, channel, asset, size, or digest; re-review the vendor release
rather than treating this pinned candidate as perpetually current.

1. Export or back up the Input profile.
2. Use direct USB and stable power.
3. Fully quit ChatGPT/Codex Desktop, Ashlr Agent Board, and every other HID or
   board controller. Do not click **Download** or enter the bootloader while any
   of them remains open.
4. Record the external backup path and the candidate firmware checksum before
   any download. Downloading is not installing; do not proceed if the asset or
   channel differs from the reviewed candidate.
5. Apply only the exact reviewed vendor-published candidate offered by the
   signed Input app; stop if it offers a different asset, prerelease, or
   channel.
6. Reconnect, confirm Input reports the intended version, and verify the saved
   profile.
7. Quit Input, declare **Codex Native** in Agent Board, and relaunch Codex. Agent
   Board may remain open as the passive evidence watcher; verify `v.oai.rgbcfg`
   followed by `v.oai.thstatus` succeeds.
8. Re-run the appropriate physical acceptance afterward. Restore the exported
   profile if the mapping or device sync changed.

## 4. Prove one shortcut receiver

Setup must say **One receiver · shortcut ownership available** before Flight
Check. Opening a development build and a packaged build at the same time can
split the 20 global shortcuts. Packaged receivers report a contended same-build
or distinct-build count. A development receiver refuses ownership whenever a
packaged peer is observed. Diagnostics return no process IDs, command lines, or
local paths, and shortcut ownership stays disabled while exclusivity is not
proven.

If Setup reports multiple receivers, use Command-Q to fully quit every **Ashlr
Agent Board** copy; closing a window is not enough. Then reopen exactly one
intended build and refresh Setup. Agent Board never quits or kills another
process automatically. An exclusive receiver proves only that one observed app
may register shortcuts; it does not prove Input Monitoring, shortcut receipt,
USB routing, or physical acceptance.

## 5. Verify Input Monitoring

Open **System Settings → Privacy & Security → Input Monitoring** and enable the application that receives the board's shortcuts. Only the logged-in user can grant this macOS permission. Agent Board does not inspect or modify the protected TCC database.

## 6. Inspect Input's cached profile

Map the physical controls to [the canonical shortcuts](controls.md#action-switches-and-motion-controls).

The daily layer has 20 independently observable gestures: six Agent keys, seven action keys, four joystick directions, and dial left/right/press. ACT10 and ACT11 are separate bottom-row switches and must have separate mappings. ACT12 is the transparent Attention key.

The Setup screen's `20/20 desktop endpoints registered` result proves only that Electron registered all expected global shortcuts. It does not inspect Input's active profile, prove that the mapping reached the board, or complete this setup step. **OS callbacks observed** is a separate privacy-safe counter that records only an allowlisted control ID, time, and allowed/rejected delivery result—even when Flight Check is blocked or inactive. The ordered physical Flight Check remains the acceptance gate for the active layer.

While Flight Check is active, the main process owns the bounded event record and the renderer reconciles it once per second. A renderer subscription gap therefore cannot erase a received Flight signal. Any misroute or event-buffer overflow latches the run invalid until a deliberate restart, even after older display events age out. Callback telemetry and a Flight receipt are still different evidence: the former proves that macOS invoked a registered accelerator, while the latter additionally requires the current safety gates and exact ordered gesture sequence.

Agent Board also reads a bounded, fixed-path copy of Input's Creator Micro 2
cache and reports only the sanitized active profile, its layer when uniquely
observable, and encoder health. A diagnostic count describes expected bindings
that match; it is never called an exact `20/20` mapping when unexpected encoder
cells, joystick sectors, or other structure are also present.
That receipt can identify the known reversed dial mapping, but it still does not
prove Input synchronized the device or that the firmware emitted a gesture.

Treat these as three separate states: the profile shown in Input's header for
editing, the profile marked current in Input and its cache, and the profile/layer
actually synchronized and emitting on hardware. The cache diagnostic can
support the second state; only Flight Check supports the third.

Input's runtime layer index and the cached keymap layer ID are different
namespaces. In the inspected vendor client, the selected layer is translated
before the device request (`layerSelectedIndex = selectedLayerIndex - 1`), so a
runtime `layer_index` of `1` can correspond to cached layer ID `0`. Doctor keeps
`cannot find specific profile index` evidence advisory and never reports a
missing cached layer from a direct numeric comparison. Use deterministic cache
content classification and a fresh physical Flight Check to choose a repair.

Matching profile and layer labels are also insufficient. If those labels are
**Ashlr Agent Board Corrected** and **Ashlr Daily** but strict content
classification fails, Doctor reports `active_profile_content_drift`. When the
bounded cache permits it, the receipt includes a matching-signal count and
specific disabled controls—for example, `19/20` with `ACT11` unbound. The same
deterministic check is enforced again by the Electron main process before
Flight Check begins. Replace
the incomplete profile with a strictly verified 20-signal artifact; selecting
the same incomplete profile as current cannot restore a missing binding.

Open the profile chooser and use **Set as current profile** for **Ashlr Agent
Board Corrected**, then verify its **Ashlr Daily** layer. Input
serializes encoder positions as clockwise, counterclockwise, press; this differs
from the user-facing left, right, press action list.

To create and activate the daily profile safely:

1. In Input's profile chooser, hover a fresh ordinary Creator Micro 2 profile
   and choose **Export Profile**. The action is an icon with that tooltip in
   Input 0.18.4. Keep this unmodified export outside the repository as rollback;
   never use a protected `KV_OAI_*` profile as the source.
2. In Agent Board Setup, choose **Create corrected Input profile**, select that
   export, and save the newly generated file. This offline flow does not open
   Input, change its cache, or write to the board. Agent Board also saves one
   private bounded handoff with the artifact path, checksum, and timestamp. On
   every resume, Agent Board reopens the bounded regular file without following
   symlinks and verifies its SHA-256 before offering to reveal it. **Copy
   recovery checklist** includes only the artifact filename and checksum, not
   the full local path. Dismissing the saved handoff removes only this startup
   reminder; it does not delete the artifact or prove any recovery step. Use
   **Reveal artifact in Finder** or **Copy recovery checklist** before quitting
   the apps that display these instructions. For development and audit, the
   equivalent CLI is:

```bash
npm run profile:generate -- source-profile.json ashlr-agent-board.json daily
npm run profile:check -- ashlr-agent-board.json daily
```

`profile:check` fails closed unless the selected file is the exact generated
one-layer variant: bounded root schema, profile and layer identity, all 20
action macros, key/encoder/joystick mappings, lighting schema, and empty
unsupported action groups. A `match` proves only that JSON file; it does not
prove import, activation, device synchronization, or physical behavior.

3. Inspect the generated **Ashlr Agent Board Corrected** profile name, **Ashlr
   Daily** layer, Mic mapping, and
   dial mapping before importing it into Input.
4. Establish an Input-only window; closing a window is not enough. Power-cycle
   the Creator Micro 2, open Input alone, choose **Import Profile**, and select
   the generated JSON. Importing performs a board write but does not make the
   new profile current. An enrolled executor may perform these visible UI steps
   only when `wrkpad commissioner status --json` reports a configured mutation
   path and its fresh plan binds the exact before-state and candidate digests.
   The current source does not. In Input 0.18.4, **Import Profile** is hidden
   when six profiles already exist; deletion is outside enrolled authority, so
   automation must stop instead of making room.
5. Resolve an existing same-name corrected profile before importing another.
   The enrolled executor must stop on duplicate-name ambiguity and must never
   delete a profile. In the guided path, export it as rollback and let the user
   decide whether to remove only that ordinary corrected copy. On the newly
   imported **Ashlr Agent Board Corrected** row, choose **Set as current
   profile** and select **Ashlr Daily**. If Input reports `update error, retry`,
   stop; an automated retry requires a fresh plan.
6. Gracefully quit Input, relaunch it alone, and require fresh checksum plus
   semantic readback for **Ashlr Agent Board Corrected** and **Ashlr Daily**.
   An enrolled executor performs this automatically and attempts its bound
   rollback once on mismatch. Input's `layout updated` message alone is not
   acceptance.
7. Reopen Agent Board and require its read-only cache receipt to report **Ashlr
   Agent Board Corrected**, **Ashlr Daily**, and the corrected directions. Then
   use **Open Input Monitoring settings** and manually verify the exact receiver
   build shown in Setup is enabled. Agent Board does not claim it can read this
   macOS permission. Then
   run a fresh daily Flight Check. If it receives zero signals or any misroute,
   stop the check and restore the exported profile before attempting firmware.

The transformer creates a new mode-`0600` JSON artifact, clears inherited
smart/multi actions and app links, and refuses to overwrite an existing file or
touch protected `KV_OAI_*` layers. It does not modify Input's database, import
or activate the result, send HID packets, or write firmware.

## Operating modes

| Mode | Apps that may remain open | What owns the board route | Evidence boundary |
| --- | --- | --- | --- |
| Ashlr Layer daily | Input, Agent Board, ChatGPT/Codex, Claude Code, Claude Desktop, and cmux | Input emits shortcuts; Agent Board receives them | Cross-provider shortcuts and hook state; no native Codex RGB claim |
| Codex Native qualification | ChatGPT Desktop plus Agent Board in passive Codex Native mode; Input remains quit | Codex vendor protocol; Agent Board unregisters all shortcuts and reads bounded evidence without opening the device | Inferred initialization plus explicit operator attestation; not cryptographic device proof |
| Hybrid Native experiment | ChatGPT Desktop and exactly one Agent Board receiver; Input remains quit after human import and post-import verification | ChatGPT is intended to own the six Agent keys; Agent Board registers the other fourteen shortcuts | Requires separate 14-signal and six-key physical acceptance; screen slots do not provide exact Claude pane focus |
| Firmware qualification | Signed Input app only after all other board/HID controllers quit | Input updater | Download, install, restored profile, and post-update acceptance remain separate |

Declaring `ashlr_layer` does not disable Codex's native device client. Daily
co-presence supports shortcut operation only and is not native ownership or RGB
evidence. For native qualification, fully quit Input and keep Agent Board on its
passive Codex Native route while ChatGPT Desktop is the sole intended HID
controller. For Input profile or firmware mutation,
fully quit Codex and Agent Board and leave signed Input as the sole intended
controller. Process absence is still not cryptographic proof of exclusivity.

Claude Code hook events can populate the runway after the guarded
[`wrkpad` hook setup](../../docs/hook-setup.md). Claude Desktop chats are not
enrolled unless a separate adapter contract has been implemented and verified.

## 7. Start the app

For development:

```bash
npm run dev
```

For a local, non-distribution, ad-hoc-sealed preview:

```bash
npm run package:mac
find release -maxdepth 3 -type d -name '*.app' -print
```

Open the architecture directory created under `release/`, then select a working directory in the app.

## Run Flight Check

The established Ashlr Layer check below expects twenty signals. The experimental
Hybrid Native route has a separate fourteen-signal order—`ACT06` through
`ACT12`, joystick up/right/down/left, then dial counterclockwise/clockwise/press—and
must be paired with the separate six-key Codex observation in
[its acceptance contract](hybrid-native-profile.md). Never use `20/20` as proof
of Hybrid Native or `14/14` as proof of its native Agent keys.

1. Open **Flight Check** and choose **Daily profile**.
2. Wait until the app says **Actions suppressed**.
3. Use only the physical board while following each gesture prompt. The rotary
   dial is at the left of the first row; the planar toggle/joystick is at the
   right. The bottom-left circle with three LEDs is the layer and
   communication-mode touch sensor—not a Flight Check gesture.
4. Confirm USB is present, Setup says **One receiver · shortcut ownership
   available**, 20 desktop shortcuts are registered, and misroutes remain zero.
5. Save the sealed receipt only after all 20 daily signals pass. The app writes
   it privately under its local application-support directory and displays only
   the filename; no save panel or local username is exposed.
6. **Start operating** appears only after the save succeeds. Use it to release
   the interlock and return to Operate.

During Flight Check, the Electron main process disables mapped actions and Agent-slot focus. Mouse clicks on the board twin do not count. Keyboard input can generate the same shortcuts, so keep hands off the keyboard during acceptance.

A passing receipt proves only that expected global shortcuts were observed in order while USB was detected and endpoints were registered. It is not cryptographic device identity, firmware qualification, native Codex RGB validation, provider activation, or permission to perform consequential actions.

Receipts are written with mode `0600` and include a SHA-256 over the canonical
payload. A completed run older than the bounded receipt window is rejected and
must be repeated. Keep receipts private and do not commit them.

## Diagnostic bottom-row test

1. Generate the disposable diagnostic profile from an ordinary export with
   `npm run profile:generate -- source.json diagnostic.json diagnostic`, then
   require `npm run profile:check -- diagnostic.json diagnostic` to match.
2. In an exclusive Input-only window, import and activate **Ashlr Flight Check
   Corrected - diagnostic**, then verify **Ashlr Diagnostic**. This performs the
   same two Input writes and restart/reconciliation checks as the daily profile.
3. Reopen Agent Board and require the exact diagnostic profile receipt before
   starting **20-signal diagnostic**. The daily profile cannot arm this check.
4. Press ACT10, then ACT11. Each must arrive as its own ordered signal.
5. Deactivate the diagnostic profile afterward.
6. Restore **Ashlr Agent Board Corrected** / **Ashlr Daily**, where ACT10 is
   Voice and ACT11 is guarded Continue, and verify its fresh read-only receipt before daily use.

## Optional agent and Fleet receipts

Agent status requires `wrkpad status --json` with schema `dev.wrkpad.hasp.state/v1`. Fleet status requires `ashlr fleet status --json` with the fields described in [architecture and trust](architecture.md#local-adapters). Tool discovery follows the search order in [troubleshooting](troubleshooting.md#a-cli-appears-missing).

Missing commands render as unavailable. Malformed responses render as invalid. Setup does not install provider tools, enable RGB, claim HID ownership, send prompts, activate Fleet authority, or sign the app.
