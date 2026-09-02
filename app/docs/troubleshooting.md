# Troubleshooting

Run desktop commands from the app directory:

```bash
cd wrkpad/app
```

## USB device is not detected

If the app says **USB absent** or the doctor reports `not detected`:

1. Connect the board directly by USB-C and confirm it is powered.
2. Try a known data-capable cable and another port.
3. Quit and reopen Agent Board after reconnecting.
4. Run `npm run doctor` again.

Bluetooth keyboard and trackpad traffic is separate. USB presence still does not prove Input Monitoring, routing, firmware compatibility, or RGB.

## Shortcuts are missing or controls do nothing

1. Confirm Work Louder Input is installed and open.
2. In Input's profile chooser, set **Ashlr Agent Board Corrected** as the current keyboard
   profile and verify **Ashlr Daily**. The profile shown for editing is not proof
   of the current keyboard profile.
3. Verify the active Input layer matches [the canonical shortcuts](controls.md).
4. Verify the receiving app under **System Settings → Privacy & Security → Input Monitoring**.
5. Check the shortcut count in Agent Board.
6. Look for another app that already owns the same global shortcut.
7. Restart Agent Board after permission or ownership changes.

All 20 desktop shortcuts must register even though daily use emits 19 signals; ACT11 remains `None` on the daily layer.

## Input-only reconciliation

Input exposes three different states: the profile shown in the editor, the
profile marked current through **Set as current profile**, and the profile/layer
actually emitting from the board. They are not interchangeable. A successful
import or `layout updated` message proves neither current-profile activation nor
physical emission.

Use this single recovery procedure when the physical check remains silent, the
cache is wrong, or Agent Board shows recent unresolved-index log evidence:

1. Stop Flight Check so the action interlock returns to a known state.
2. In Input's profile chooser, hover an ordinary Creator Micro 2 profile and
   choose **Export Profile**. Keep it as rollback. If Setup reports reversed or
   unverified dial directions, return to Agent Board and use **Create corrected
   Input profile** with that export. The artifact does not activate itself or
   write to the device. A resumed handoff re-verifies the exact bounded artifact
   by SHA-256 before reveal; the copied checklist includes its filename and
   checksum but omits the full local path. Dismissing that handoff removes only
   the startup reminder and proves no recovery step. Use **Reveal artifact in
   Finder** or **Copy recovery checklist** before quitting the instruction
   surfaces.
3. Use Command-Q to fully quit Agent Board, Codex/ChatGPT, Claude, and every
   other board controller; closing a window is not enough. Power-cycle the board.
4. Open Input alone, choose **Import Profile**, and select the corrected
   artifact. If **Import Profile** is absent, Input already has six profiles:
   export a backup and remove only an unused ordinary profile. Never delete or
   transform a protected `KV_OAI_*` profile or layer.
5. Avoid ambiguous same-name copies: export and remove only an older ordinary
   **Ashlr Agent Board Corrected** profile before importing its replacement. On
   the imported row choose **Set as current profile**, then select **Ashlr
   Daily**.
6. Wait for Input to finish. `layout updated` is not acceptance. If Input says
   `update error, retry`, keep Input as the only board controller and retry; do
   not continue from an error.
7. Use Command-Q to fully quit Input and relaunch it alone. Confirm **Ashlr Agent
   Board Corrected** is still current with **Ashlr Daily** selected.
8. Reopen Agent Board, choose **Open Input Monitoring settings**, and manually
   verify the exact receiver build shown in Setup is enabled. Agent Board keeps
   this permission labeled human-unverified because it cannot read the protected
   macOS permission database.
9. Run a fresh physical Flight Check without simulating shortcuts from the
   keyboard.

Recent unresolved-index evidence may predate the current cache, so it is an
advisory rather than proof of the current board state. Do not reset, delete or
transform a protected `KV_OAI_*` layer, or flash firmware from that evidence.

If Setup reports recurring Codex-protocol responses reaching Input, treat that
as current controller co-presence only. It does not identify HID ownership or
prove why a shortcut was silent, but it does mean the Input-only reconciliation
window is not exclusive. End Flight Check and establish the human-guided
Input-only window above; Agent Board does not quit applications automatically.

If Flight Check receives zero raw signals, use the top-right black rotary dial.
The top-left white control is the joystick and the bottom-left circle is the
Bluetooth host selector. If the correct control still emits nothing, do not
simulate the shortcut from the keyboard. Complete the Input-only reconciliation
above, then confirm the fresh check still records `0` raw receipts.

Only after a fresh second check still receives zero signals should firmware
qualification be considered. Keep the
external profile backup and fully quit ChatGPT/Codex Desktop, Agent Board, and
every other board/HID controller before the signed Input updater downloads or
enters a bootloader.

## Codex finds Creator Micro but native connection fails

Run `npm run doctor -- --json`. If **Codex native Creator Micro** reports
`v.oai.rgbcfg returned RPC 404`, the cable, USB identity,
and vendor HID request/response path already worked. The board firmware lacks
the first Codex control-plane method; Bluetooth keyboard/trackpad traffic and
Agent Board's global shortcuts are not the cause.

Do not repeatedly reconnect, grant more permissions, or quit Logitech just to
clear this error. Follow the [separate firmware qualification
workflow](setup.md#3-install-work-louder-input). The currently published vendor
release is only a qualification candidate until this exact desk path passes.
After updating, test Codex with
Input fully quit. Codex must receive successful `v.oai.rgbcfg` and then
`v.oai.thstatus` responses before native keys or lighting are described as
connected.

If those calls succeed but Codex still fails, verify Input Monitoring and test
Codex as the only open board controller. Codex and Input can hold nonexclusive
HID handles, but they do not share a cross-process RPC or lighting lease.

## The wide Mic cap fires twice

The cap spans ACT10 and ACT11. Map Mic to ACT10 and set ACT11 to `None` for daily use. Use the [diagnostic Mic test](setup.md#diagnostic-mic-test) only on a disposable layer.

## Flight Check records a misroute

Flight Check is ordered. A correct shortcut pressed during the wrong step is a misroute and is not banked for later.

Stop the check, correct the mapping, keep hands off the keyboard, then start a clean receipt. A run with any misroute cannot pass.

## Agent observer is unavailable or invalid

**Unavailable** means `wrkpad` could not start, timed out, returned nonzero, or exceeded the output limit. **Invalid** means its JSON did not match `dev.wrkpad.hasp.state/v1` with a `slots` array.

```bash
wrkpad status --json
```

If the command works but the screen is stale, allow for the 10-second refresh and eight-second main-process cache, then reopen the app.

## Fleet is unavailable, invalid, offline, or blocked

```bash
ashlr fleet status --json
```

- **Unavailable:** execution failed or timed out.
- **Invalid:** required fields are missing or unsafe.
- **Offline:** a valid receipt says the daemon is not running.
- **Blocked:** a valid receipt identifies a guard, kill switch, or authority constraint.

Do not remove a Fleet guard merely to turn the UI green. Resolve the named issue in Ashlr Hub and run its verification.

## Selecting a slot opens the wrong surface

The focus contract is narrow: Codex opens ChatGPT, Claude Code opens cmux, and unknown providers open nothing. Exact Codex task and cmux pane correlation are not implemented. There is no window search, terminal typing, or prompt fallback.

## A CLI appears missing

Runtime discovery checks `~/.local/bin`, `~/.npm-global/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, and `/usr/bin`. It intentionally ignores inherited `PATH` entries. The file must be executable. Install or symlink the CLI into a supported directory, then restart the app.

The doctor treats ChatGPT, Codex CLI, native Codex control, Claude Code, and Ashlr Hub as optional integrations. A missing or firmware-incompatible optional integration produces a warning but does not fail the required board and Work Louder Input checks. In JSON output, `nextAction` prioritizes a failed required check, the declared Codex Native route's guarded qualification, or the next manual physical gate. Ashlr Layer never promotes a native firmware operation.

## A confirmation expires

Authorizations expire after 30 seconds and fail if the window, action, or workspace changes. Select the action again. Hold actions also require a continuous 1.6-second hold.

## The package will not open

`npm run package:mac` creates an unsigned, unpacked app, not a notarized public release. Use `npm run dev` for development and follow [release and readiness](release-readiness.md) for distribution.

If the problem remains, prepare a minimal redacted report using [support](../SUPPORT.md).
