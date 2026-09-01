# Setup and Flight Check

Setup proves six different things: USB presence, declared board route, native
Codex firmware compatibility, macOS authority, shortcut configuration, and
physical routing. Do not treat one as proof of the others.

## 1. Connect the board

Connect the Creator Micro 2 directly over USB-C for commissioning. A Bluetooth keyboard and trackpad can remain connected.

```bash
npm run doctor
```

Expected USB result: `Creator Micro 2 USB: Work Louder 303A:8298`. The board and Work Louder Input are required doctor checks. ChatGPT, Codex CLI, Claude Code, and Ashlr Hub are optional integrations: missing tools produce warnings but do not fail the doctor.

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

## 3. Install Work Louder Input

Install the signed vendor application from [Work Louder](https://worklouder.cc/input/). Input owns board profiles, layers, shortcuts, firmware updates, and its radial menu. Agent Board does not write firmware or Input's configuration database.

Do not use QMK/VIA instructions intended for the legacy Creator Micro v1.

If Input offers a firmware update during Ashlr-layer commissioning, defer it.
Firmware availability is not firmware qualification, and changing firmware
invalidates the configuration baseline.

For **Codex Native**, a recent Codex log result of
`firmware_rpc_missing` is different: USB and HID work, but the board returned
RPC 404 for `v.oai.rgbcfg`. The tested desk unit reports firmware `v0.1.50`.
Work Louder currently marks [Creator Micro v2 firmware
v0.6.2](https://github.com/worklouder/cm-v2-fw-releases/releases/tag/v0.6.2)
as its latest release, and its release asset contains both required Codex RPC
names. That string-level evidence makes v0.6.2 a vendor candidate, not a proven
compatible minimum for PID `303A:8298` or the installed Codex build. Updating
remains an explicit vendor operation and the post-update checks below are the
acceptance gate:

1. Export or back up the Input profile.
2. Use direct USB and stable power.
3. Fully quit Codex and every other board controller.
4. Apply only the stable/latest version offered by the signed Input app; stop if
   it offers a prerelease or different channel.
5. Reconnect, confirm Input reports the intended version, and verify the saved
   profile.
6. Quit Input, launch Codex alone, and verify `v.oai.rgbcfg` followed by
   `v.oai.thstatus` succeeds.
7. Re-run the appropriate physical acceptance afterward.

## 4. Grant Input Monitoring

Open **System Settings → Privacy & Security → Input Monitoring** and enable the application that receives the board's shortcuts. Only the logged-in user can grant this macOS permission. Agent Board does not inspect or modify the protected TCC database.

## 5. Create the daily Input layer

Map the physical controls to [the canonical shortcuts](controls.md#action-switches-and-motion-controls).

The daily layer has 19 gestures: six Agent keys, six visible action caps, four joystick directions, and dial left/right/press. The desktop reserves 20 shortcut endpoints because the Mic cap covers two switches. Assign the Mic shortcut to ACT10 and set ACT11 to `None` for daily use. Never give the two hidden halves different daily actions.

The Setup screen's `20/20 desktop endpoints registered` result proves only that Electron registered all expected global shortcuts. It does not inspect Input's active profile, prove that the mapping reached the board, or complete this setup step. The ordered physical Flight Check is the acceptance gate for the active layer.

## 6. Start the app

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
3. Use only the physical board while following each gesture prompt.
4. Confirm USB is linked, 20 desktop shortcuts are registered, and misroutes remain zero.
5. Export a receipt only after all 19 daily signals pass.
6. Stop Flight Check or return to Operate to release the interlock.

During Flight Check, the Electron main process disables mapped actions and Agent-slot focus. Mouse clicks on the board twin do not count. Keyboard input can generate the same shortcuts, so keep hands off the keyboard during acceptance.

A passing receipt proves only that expected global shortcuts were observed in order while USB was detected and endpoints were registered. It is not cryptographic device identity, firmware qualification, native Codex RGB validation, provider activation, or permission to perform consequential actions.

Receipts are written with mode `0600` and include a SHA-256 over the canonical payload. Store them privately and do not commit them.

## Diagnostic Mic test

1. Create a disposable Input layer.
2. Map ACT10 and ACT11 to their separate expected shortcuts.
3. Start **20-signal diagnostic**.
4. Press the wide cap once; both signals must arrive within 250 milliseconds.
5. Deactivate the disposable layer afterward.
6. Restore ACT11 to `None` on the daily layer.

## Optional agent and Fleet receipts

Agent status requires `wrkpad status --json` with schema `dev.wrkpad.hasp.state/v1`. Fleet status requires `ashlr fleet status --json` with the fields described in [architecture and trust](architecture.md#local-adapters). Tool discovery follows the search order in [troubleshooting](troubleshooting.md#a-cli-appears-missing).

Missing commands render as unavailable. Malformed responses render as invalid. Setup does not install provider tools, enable RGB, claim HID ownership, send prompts, activate Fleet authority, or sign the app.
