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

## 2. Declare the board route

Agent Board stores one local expectation:

- **Codex Native:** Codex is expected to handle vendor HID events and lighting.
- **Ashlr Layer:** Work Louder Input is expected to emit the canonical desktop
  shortcuts for Codex, Claude Code/cmux, and Ashlr Fleet.
- **Not selected:** no physical route is inferred.

This is labeled **Declared here — not detected**. Changing it writes only the
private Agent Board settings file. It does not change firmware, Input, Codex,
shortcuts, processes, hooks, or `wrkpad` occupancy.

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
7. Quit Input, launch Codex alone, and verify `v.oai.rgbcfg` followed by
   `v.oai.thstatus` succeeds.
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

The daily layer has 19 gestures: six Agent keys, six visible action caps, four joystick directions, and dial left/right/press. The desktop reserves 20 shortcut endpoints because the Mic cap covers two switches. Assign the Mic shortcut to ACT10 and set ACT11 to `None` for daily use. Never give the two hidden halves different daily actions.

The Setup screen's `20/20 desktop endpoints registered` result proves only that Electron registered all expected global shortcuts. It does not inspect Input's active profile, prove that the mapping reached the board, or complete this setup step. The ordered physical Flight Check is the acceptance gate for the active layer.

Agent Board also reads a bounded, fixed-path copy of Input's Creator Micro 2
cache and reports only the sanitized active profile, its layer when uniquely
observable, and encoder health.
That receipt can identify the known reversed dial mapping, but it still does not
prove Input synchronized the device or that the firmware emitted a gesture.

Treat these as three separate states: the profile shown in Input's header for
editing, the profile marked current in Input and its cache, and the profile/layer
actually synchronized and emitting on hardware. The cache diagnostic can
support the second state; only Flight Check supports the third.

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
```

3. Inspect the generated **Ashlr Agent Board Corrected** profile name, **Ashlr
   Daily** layer, Mic mapping, and
   dial mapping before importing it into Input.
4. Use Command-Q to fully quit Agent Board, Codex/ChatGPT, Claude, and every
   other board controller; closing a window is not enough. Power-cycle the
   Creator Micro 2, open Input alone, choose **Import Profile**, and select the
   generated JSON. Importing performs a board write but does not make the new
   profile current. In Input 0.18.4, **Import Profile** is hidden when six
   profiles already exist. If it is absent, export a backup and remove only an
   unused ordinary profile; never delete or transform a protected `KV_OAI_*`
   profile or layer.
5. Resolve an existing same-name corrected profile before importing another:
   export it as rollback, then remove only that ordinary corrected copy. On the
   newly imported **Ashlr Agent Board Corrected** row, choose **Set as current
   profile** and select **Ashlr Daily**. Wait for Input to finish. If it reports
   `update error, retry`, keep Input as the only board controller and retry; do
   not continue from an error.
6. Use Command-Q to fully quit Input, relaunch it alone, and confirm **Ashlr
   Agent Board Corrected** is still current with **Ashlr Daily** selected.
   Input's `layout updated` message alone is not acceptance.
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
| Codex Native qualification | Codex alone; Input and Agent Board device routing fully quit | Codex vendor protocol | Native RPC and lighting qualification only |
| Firmware qualification | Signed Input app only after all other board/HID controllers quit | Input updater | Download, install, restored profile, and post-update acceptance remain separate |

Declaring `ashlr_layer` does not disable Codex's native device client. Daily
co-presence supports shortcut operation only and is not native ownership or RGB
evidence. For native qualification, fully quit Input and Agent Board and leave
Codex as the sole intended controller. For Input profile or firmware mutation,
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

For a local unsigned package:

```bash
npm run package:mac
find release -maxdepth 3 -type d -name '*.app' -print
```

Open the architecture directory created under `release/`, then select a working directory in the app.

## Run Flight Check

1. Open **Flight Check** and choose **Daily profile**.
2. Wait until the app says **Actions suppressed**.
3. Use only the physical board while following each gesture prompt. The white
   control at top-left is the joystick, the black control at top-right is the
   rotary dial, and the bottom-left circle with three LEDs is the layer and
   communication-mode touch sensor—not a Flight Check gesture.
4. Confirm USB is present, Setup says **One receiver · shortcut ownership
   available**, 20 desktop shortcuts are registered, and misroutes remain zero.
5. Export a receipt only after all 19 daily signals pass.
6. Stop Flight Check or return to Operate to release the interlock.

During Flight Check, the Electron main process disables mapped actions and Agent-slot focus. Mouse clicks on the board twin do not count. Keyboard input can generate the same shortcuts, so keep hands off the keyboard during acceptance.

A passing receipt proves only that expected global shortcuts were observed in order while USB was detected and endpoints were registered. It is not cryptographic device identity, firmware qualification, native Codex RGB validation, provider activation, or permission to perform consequential actions.

Receipts are written with mode `0600` and include a SHA-256 over the canonical payload. Store them privately and do not commit them.

## Diagnostic Mic test

1. Generate the disposable diagnostic profile from an ordinary export with
   `npm run profile:generate -- source.json diagnostic.json diagnostic`.
2. In an exclusive Input-only window, import and activate **Ashlr Flight Check
   Corrected - diagnostic**, then verify **Ashlr Diagnostic**. This performs the
   same two Input writes and restart/reconciliation checks as the daily profile.
3. Reopen Agent Board and require the exact diagnostic profile receipt before
   starting **20-signal diagnostic**. The daily profile cannot arm this check.
4. Press the wide cap once; both signals must arrive within 250 milliseconds.
5. Deactivate the diagnostic profile afterward.
6. Restore **Ashlr Agent Board Corrected** / **Ashlr Daily**, where ACT11 is
   `None`, and verify its fresh read-only receipt before daily use.

## Optional agent and Fleet receipts

Agent status requires `wrkpad status --json` with schema `dev.wrkpad.hasp.state/v1`. Fleet status requires `ashlr fleet status --json` with the fields described in [architecture and trust](architecture.md#local-adapters). Tool discovery follows the search order in [troubleshooting](troubleshooting.md#a-cli-appears-missing).

Missing commands render as unavailable. Malformed responses render as invalid. Setup does not install provider tools, enable RGB, claim HID ownership, send prompts, activate Fleet authority, or sign the app.
