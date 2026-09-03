# Troubleshooting

Run desktop commands from the app directory:

```bash
cd wrkpad/app
```

## USB device is not detected

If the app says **USB absent** or the doctor reports `not detected`:

1. Connect the board directly by USB-C and confirm it is powered.
2. On a Pro model, hold the bottom-left touch sensor for three seconds, then tap
   through the three Bluetooth channels to the fourth **WIRED** channel. The
   underglow turns white. Let communication mode exit after five seconds.
3. Try a known data-capable cable and another port.
4. Fully quit and reopen Agent Board after reconnecting.
5. Run `npm run doctor` again.

The general [Creator Micro 2 setup](https://worklouder.cc/micro-setup) says USB
insertion switches a Pro to wired mode, but the current
[Codex Micro guide](https://learn.chatgpt.com/docs/features/codex-micro) says it
only charges while Bluetooth remains selected. For Codex troubleshooting,
explicitly select the white wired channel rather than relying on cable insertion.
White underglow is human-visible mode evidence only; it is not a USB receipt.
Bluetooth keyboard and Apple trackpad traffic is separate and does not need to
be disconnected. USB presence still does not prove Input Monitoring, routing,
firmware compatibility, or RGB.

## Work Louder Input is installed but not verified

Setup accepts Input only when it says **publisher, signature, and Gatekeeper
verified**. The app deliberately shows a sanitized reason such as `invalid
signature`, `publisher unrecognized`, `Gatekeeper rejected`, `multiple
installations`, `unsafe`, `known resource mutation`, or `probe unavailable`; it
does not display raw signing output, a local app path, or publisher identifiers.
The official DMG installs lowercase `input.app`; the detector probes that exact
fixed name and still rejects symlinks, alternate locations, and noncanonical
ancestors.

On the tested desk, the official Input 0.18.4 replacement passed all three
checks before the approved September 2 update, then repeated the same single
sealed `window-info` helper mutation during that session. The installed copy is
currently unverified for another Input-controlled operation. Input can remain
closed for native Codex qualification. See the canonical
[post-flash evidence record](../../docs/creator-micro-2-post-flash-2026-09-02.md).
This bounded diagnosis does not identify the writer or authorize a signature
exception.

For any result other than verified:

1. Stop Flight Check and do not open a firmware updater.
2. Use Command-Q to fully quit Input. Agent Board will not quit it for you.
3. Download a fresh Input installer from the official
   [Work Louder page](https://worklouder.cc/input/).
4. Replace the unverified installation in Finder. If Input exists in both
   `/Applications` and the user's Applications folder, keep one intended
   official installation and resolve the duplicate manually.
5. Refresh Setup while Input remains closed and require the verified status
   before launching Input, importing a profile, or synchronizing the device.

Do not bypass Gatekeeper, strip quarantine metadata, ad-hoc sign Input, or let
an agent remove application bundles. A verified installation proves publisher,
signature, and Gatekeeper assessment for that copy only; it does not prove
permission, current profile, device synchronization, firmware compatibility, or
physical acceptance.

## Multiple Agent Board receivers are running

Setup says **One receiver · shortcut ownership available** only when one exact
Ashlr Agent Board main process is observed. If it reports multiple receivers or
Flight Check says **Receiver · Contended**, the app disables shortcut ownership
so two copies cannot silently divide the 20 registrations.

Use Command-Q to fully quit every Ashlr Agent Board copy, including development
and packaged builds; closing a window is not enough. Reopen exactly one intended
build and refresh Setup. Do not use an agent or shell command to kill processes.
Packaged copies produce bounded instance/build counts and hashes; a development
copy fails closed when a packaged peer is present. Neither mode exposes process
IDs, command lines, app paths, or raw process output.
**Exclusive** proves only the observed receiver count, not Input Monitoring,
shortcut receipt, USB ownership, or physical acceptance.

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
The top-left white control is the joystick. The bottom-left circle is the
layer/communication-mode touch sensor, not the dial and not a Flight Check
gesture. If the correct control still emits nothing, do not
simulate the shortcut from the keyboard. Complete the Input-only reconciliation
above, then confirm the fresh check still records `0` raw receipts.

Only after a fresh second check still receives zero signals should firmware
qualification be considered for a device that is actually outdated. The tested
desk already runs `0.6.2`; do not reflash it merely because a physical receipt
is missing. Its current post-flash state and remaining acceptance gates are in
the canonical
[evidence record](../../docs/creator-micro-2-post-flash-2026-09-02.md).

## Codex finds Creator Micro but native connection fails

Run `npm run doctor -- --json`. If **Codex native Creator Micro** reports
`v.oai.rgbcfg returned RPC 404`, the cable, USB identity,
and vendor HID request/response path already worked. The board firmware lacks
the first Codex control-plane method; Bluetooth keyboard/trackpad traffic and
Agent Board's global shortcuts are not the cause.

Do not repeatedly reconnect, grant more permissions, or quit Logitech just to
clear a confirmed 404. Follow the [separate firmware qualification
workflow](setup.md#3-verify-work-louder-input). After updating, test Codex with
Input fully quit. Codex must receive successful `v.oai.rgbcfg` and then
`v.oai.thstatus` responses before native keys or lighting are described as
connected. On the tested desk, the updated firmware accepted both methods, but
Codex consumption and physical behavior remain unproven; see the
[post-flash evidence](../../docs/creator-micro-2-post-flash-2026-09-02.md).

If those calls succeed but Codex still fails, require Codex Settings → Creator
Micro to show both **Connection: Connected** and **Input Monitoring: Granted**,
then test Codex as the only open board controller. Detected-only or Connection
failed does not count. Codex and Input can hold nonexclusive HID handles, but
they do not share a cross-process RPC or lighting lease.

After a firmware update, fully quit and reopen ChatGPT Desktop before drawing a
new conclusion. An app process that started before the update may have only the
historical failed attempt in its current log session. In Agent Board, select
**Codex Native**, choose **Prepare handoff**, Command-Q ChatGPT Desktop, Work
Louder Input, and Agent Board, then reopen ChatGPT Desktop alone. Reopen Agent
Board and choose **Refresh
after isolated retry**. The evidence ladder intentionally stops at **Initialization
inferred** until you separately observe Codex Settings and every physical
control group. The fresh initialization timestamp supports the retry sequence;
it does not prove a new process generation.

If preparation is unavailable, resolve the exact prerequisite shown in Setup:

- **USB not observed:** select the board's wired channel and retry a data cable
  or port.
- **ChatGPT Desktop not found/unavailable:** install or repair the official app
  at `/Applications/ChatGPT.app`; the probe does not scan alternate paths.
- **Codex Native not declared:** select that route. The declaration is local
  expectation only.
- **Initialization not observed:** restart ChatGPT Desktop after preparation
  with Input and Agent Board quit, then refresh. Do not check physical outcomes
  that you did not see.

If Setup reports **Acceptance interrupted before completion**, the two-phase
save stopped before its final promotion. It is a durable non-accepted state,
not a partial success. Select **Start fresh handoff** once to replace the staged
observations with a clean preparation, then repeat the isolated retry and every
manual observation. **Clear handoff** is the alternative when you do not want
to resume. The card announces the exact prepare, refresh, accept, or clear
operation while it is running; do not infer success from a disabled button.

Clearing the handoff is safe recovery for a stale or mismatched receipt. It
does not clear Codex settings, disconnect USB, revert firmware, or change Input.

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

The doctor evaluates prerequisites for the requested route. **Ashlr Layer** requires the board and a verified Work Louder Input installation. **Codex Native** requires the board and ChatGPT Desktop; Input must remain quit, so its integrity result is advisory for a read-only native retry and blocking again only before a later Input-controlled profile or firmware operation. Codex CLI, Claude Code, and Ashlr Hub remain optional integrations. In JSON output, `nextAction` prioritizes a failed route prerequisite, the declared Codex Native route's guarded qualification, or the next manual physical gate. Ashlr Layer never promotes a native firmware operation.

## A confirmation expires

Authorizations expire after 30 seconds and fail if the window, action, or workspace changes. Select the action again. Hold actions also require a continuous 1.6-second hold.

## The package will not open

`npm run package:mac` creates an unsigned, unpacked app, not a notarized public release. Use `npm run dev` for development and follow [release and readiness](release-readiness.md) for distribution.

If the problem remains, prepare a minimal redacted report using [support](../SUPPORT.md).
