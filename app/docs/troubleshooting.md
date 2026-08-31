# Troubleshooting

Run commands from the repository root.

## USB device is not detected

If the app says **USB absent** or the doctor reports `not detected`:

1. Connect the board directly by USB-C and confirm it is powered.
2. Try a known data-capable cable and another port.
3. Quit and reopen Agent Board after reconnecting.
4. Run `npm run doctor` again.

Bluetooth keyboard and trackpad traffic is separate. USB presence still does not prove Input Monitoring, routing, firmware compatibility, or RGB.

## Shortcuts are missing or controls do nothing

1. Confirm Work Louder Input is installed and open.
2. Verify the active Input layer matches [the canonical shortcuts](controls.md).
3. Verify the receiving app under **System Settings → Privacy & Security → Input Monitoring**.
4. Check the shortcut count in Agent Board.
5. Look for another app that already owns the same global shortcut.
6. Restart Agent Board after permission or ownership changes.

All 20 desktop shortcuts must register even though daily use emits 19 signals; ACT11 remains `None` on the daily layer.

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

## A confirmation expires

Authorizations expire after 30 seconds and fail if the window, action, or workspace changes. Select the action again. Hold actions also require a continuous 1.6-second hold.

## The package will not open

`npm run package:mac` creates an unsigned, unpacked app, not a notarized public release. Use `npm run dev` for development and follow [release and readiness](release-readiness.md) for distribution.

If the problem remains, prepare a minimal redacted report using [support](../SUPPORT.md).
