# Creator Micro 2 post-flash evidence — September 2, 2026

This is the canonical evidence record for the tested Creator Micro 2 after its
foreground firmware update. It separates firmware capability from native Codex,
Ashlr Layer, physical, provider, and user acceptance.

## Audit context

- Repository: `ashlrai/wrkpad`
- Branch: `codex/creator-micro-physical-recovery`
- Source HEAD when the runtime evidence was captured:
  `22b3d9ae159142dc93094f1e0ec359026a104c49`
- Working tree: not clean; separate diagnostic code and test changes were in
  progress. The hardware observations below came from operating-system and
  vendor logs, not those changes.
- Capture window: September 2, 2026, 18:56:21–19:06:30 EDT
- Method: read-only after the operator-completed vendor update. The audit did
  not open a HID handle, send a HID report, alter permissions, or modify the
  device or installed applications.

## Before and after

| Evidence | Before update | After update | What it proves |
| --- | --- | --- | --- |
| Firmware | Input reported `v0.1.50` | `sys.version` returned `0.6.2` at 18:56:44.988 | The tested device rebooted into the intended firmware |
| Vendor update result | Update required | Input reported **No firmware update needed** at 18:56:46.212 | Input recognized the installed version |
| Codex RPCs | `v.oai.rgbcfg` returned RPC 404 | `v.oai.rgbcfg` and `v.oai.thstatus` returned `{ok:1}` | Firmware implements and accepts both methods |
| HID descriptor | 275 bytes, SHA-256 `9257d7361f9c784e0fc0b260bbac0feadd49bf79cbb6202d6c41560cbae96fb6` | 207 bytes, SHA-256 `f02b260e679ce19b3bc7067f816915e448cb5c4f576077017a09fe1d8677ab0b` | A real firmware/USB interface change occurred |
| Native Codex connection | Failed on the missing first RPC | Not yet independently observed | Capability success is not a native connection receipt |

The update reached 100% at 18:56:36.999, ended at 18:56:40.437, reset the
device at 18:56:40.644, and rediscovered it at 18:56:44.978. The first
post-update `v.oai.rgbcfg` and `v.oai.thstatus` successes were observed at
18:57:02.489 and 18:57:02.549.

Those RPC responses appeared in Input's log as responses with no matching
Input resolver. They prove that the board accepted the methods. They do not
identify which competing process issued each request, prove that Codex consumed
the responses, or prove native keys or lighting.

## Input integrity boundary

Before launch, the replacement Input 0.18.4 copy from the verified official DMG
passed publisher, strict signature, and Gatekeeper checks. The unchanged DMG has
SHA-256 `8192f5170cac808e4ecd000c8494a5b9fd44c4a91a5bd773a802a086ddf43690`
and still passes its image checksum.

After the legitimate update session, strict verification found exactly one
modified sealed resource: `window-info-retriever.scpt`. Its modification time
was 19:02:25, immediately before Input disconnected from HID and shut down at
19:02:26.534. No other file in the app bundle had a modification time from the
session. This is the same bounded resource path as the earlier
`known_resource_mutation` observation.

The signed resource manifest expects SHA-256
`44e74b8dccd560ef186d6cd2a2e6aa1abbbbcd8ed9078370487d1eee88669ab6`;
the post-session file has SHA-256
`fa8837793f55933b71f5cdbf35a6c8e9efab7eac56d19c5a0f28664b451461ba`.

This timing proves the resource changed while Input was running. It does not
prove that firmware flashing caused the change, and the earlier mutated file's
digest was not retained, so byte-for-byte identity with the earlier mutation is
unknown. The installed Input copy is therefore unverified for any future
profile, device-file, or firmware operation. Do not create a signature
exception, ad-hoc sign it, or bypass Gatekeeper.

Input integrity and native Codex runtime are separate gates. Codex does not
need Input to remain open. With Input stopped, this dormant configurator state
does not invalidate the board's USB enumeration or installed firmware, but it
does block future Input-controlled mutations until a pristine official copy is
restored and verified before launch.

## Post-update topology

At the 19:03 EDT snapshot:

- IORegistry and `hidutil` enumerated Creator Micro 2 `303A:8298` over `USB`.
  No Creator Micro Bluetooth entry was observed. This is positive wired USB
  data-path evidence, not a charging-only inference.
- The post-update descriptor exposed 64-byte input and output reports and the
  207-byte descriptor recorded above.
- Codex Desktop 26.818.61809 was running.
- Work Louder Input was stopped after its clean HID disconnect.
- No Agent Board receiver and no Karabiner process were observed.
- The Logitech Options+ background agent remained running. Process presence is
  only a contention risk; it does not prove that Logitech opened this device.
- `system_profiler` did not list the matching USB child while IORegistry and
  `hidutil` did. The sources disagree; the affirmative HID evidence must not be
  rewritten as absence.

This was a bounded process snapshot, not proof of exclusive HID ownership.

## Acceptance still required

| Gate | State at this snapshot |
| --- | --- |
| Firmware update completed and version re-read | Verified |
| Wired USB/HID presence | Verified |
| Both required firmware RPC methods accepted | Verified by board responses |
| Current Input installation trusted for another mutation | Blocked by known sealed-resource mutation |
| Codex consumed both RPC responses in an exclusive retry | Not observed |
| Native Codex key and lighting behavior | Not physically accepted |
| Ashlr Layer profile synchronization and 20-gesture Flight Check after update | Not performed |
| Provider and operator workflow acceptance | Not performed |

The next native qualification must keep Input and Agent Board closed, make
Codex the sole intended board controller, and capture a fresh native connection
plus visible key and lighting behavior. If contention remains, investigate the
named background utility separately; permission changes require the operator.
Do not reflash solely because native or physical acceptance is still pending.

For a future Input-controlled operation, first replace the mutated app from the
verified official release, verify publisher, strict signature, and Gatekeeper
before launch, perform only the approved foreground operation, quit Input, and
reconcile both app integrity and device state afterward.
