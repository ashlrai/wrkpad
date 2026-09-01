# Setup and Flight Check

Setup proves four different things: USB presence, macOS authority, shortcut configuration, and physical routing. Do not treat one as proof of the others.

## 1. Connect the board

Connect the Creator Micro 2 directly over USB-C for commissioning. A Bluetooth keyboard and trackpad can remain connected.

```bash
npm run doctor
```

Expected USB result: `Creator Micro 2 USB: Work Louder 303A:8298`.

The doctor also checks local app and CLI paths. It is read-only and cannot grant permissions or change board configuration. If USB is absent, use [troubleshooting](troubleshooting.md#usb-device-is-not-detected).

## 2. Install Work Louder Input

Install the signed vendor application from [Work Louder](https://worklouder.cc/input/). Input owns board profiles, layers, shortcuts, firmware updates, and its radial menu. Agent Board does not write firmware or Input's configuration database.

Do not use QMK/VIA instructions intended for the legacy Creator Micro v1.

If Input offers a firmware update during commissioning, defer it. Firmware availability is not firmware qualification, and changing firmware invalidates the configuration baseline you are trying to test. Plan an update as a separate operation with the active profile backed up, an explicit rollback path, and a fresh Flight Check afterward.

## 3. Grant Input Monitoring

Open **System Settings → Privacy & Security → Input Monitoring** and enable the application that receives the board's shortcuts. Only the logged-in user can grant this macOS permission. Agent Board does not inspect or modify the protected TCC database.

## 4. Create the daily Input layer

Map the physical controls to [the canonical shortcuts](controls.md#action-switches-and-motion-controls).

The daily layer has 19 gestures: six Agent keys, six visible action caps, four joystick directions, and dial left/right/press. The desktop reserves 20 shortcut endpoints because the Mic cap covers two switches. Assign the Mic shortcut to ACT10 and set ACT11 to `None` for daily use. Never give the two hidden halves different daily actions.

The Setup screen's `20/20 desktop endpoints claimed` result proves only that Electron registered all expected global shortcuts. It does not inspect Input's active profile, prove that the mapping reached the board, or complete this setup step. The ordered physical Flight Check is the acceptance gate for the active layer.

## 5. Start the app

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
