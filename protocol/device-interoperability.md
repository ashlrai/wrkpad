# Device interoperability contract

The Creator Micro 2 and Codex Micro host protocol is not an official public SDK. `wrkpad` treats community interoperability evidence as versioned, private adapter input—not as a vendor guarantee.

## Discovery identity

| Identity | Handling |
| --- | --- |
| `303A:8297` | Creator Micro 2 candidate; require strings, vendor usage, descriptor fingerprint, firmware, and capability receipt |
| `303A:8298` | Creator Micro 2, previously observed on the Ashlr desk; same gates |
| `303A:8360` | Codex Micro candidate; same gates |
| `574C:E6E3` | Legacy v1/QMK explanation only; never send current-generation RPC |

`0x303A` is Espressif's vendor ID and is not unique to Work Louder. VID/PID alone never enables writes.

## Community-observed framing

The pure framing module models this 64-byte logical report:

```text
byte 0     report ID 0x06
byte 1     channel: 1 debug, 2 RPC
byte 2     payload byte count, 0..61
byte 3..63 UTF-8/JSON fragment
```

Some host APIs include the report ID in the buffer; others expose a 63-byte view with the report ID out of band. Tests cover both. Messages are reassembled before UTF-8/JSON parsing, bounded at 32 KiB, and correlated by request ID.

Host RPC requests observed by community projects use `{ "method", "params", "id" }` without a `jsonrpc` member. Conservative IDs remain in `1..999`.

The public v0.1 constructor allows only:

- `sys.version`
- `device.status`

The implementation has no device-open or send path. Lighting, bootloader, filesystem, keymap, firmware, and profile methods cannot be constructed through the read-only API.

## Lighting evidence, not implementation

Hardware-tested community projects report:

- `v.oai.rgbcfg` controls global keys and ambient zones;
- `v.oai.thstatus` controls Agent/thread states when supported;
- active key positions need appropriate `KV_OAI_AG*` bindings for addressable output;
- multiple clients can receive foreign replies or race as last writer;
- an `ok` response can occur without visible light when prerequisites are wrong.

If both lighting surfaces are eventually painted, wrkpad will use `rgbcfg`, a correlated response and pacing interval, then a complete `thstatus` frame. This is a Desktop-compatible composite convention, not a claimed wire requirement. A thread-only update may eventually use `thstatus` alone after exact-tuple acceptance.

No firmware range such as `>=0.4.0` authorizes writes. Capability lookup uses the complete tested tuple:

```text
(VID, PID, manufacturer, product, transport, usage pair,
 descriptor SHA-256, firmware, active layer/profile)
```

## Safe empirical sequence

1. Run `wrkpad doctor --dump-hid` with the device wired. This is read-only and outputs redacted identity evidence plus an explicit descriptor-capture status. The current v0.1 backend does not open the HID device or claim a descriptor hash.
2. Quit likely writers manually. wrkpad never terminates them.
3. Capture descriptor and firmware evidence through a reviewed shadow adapter.
4. Register an exact compatibility tuple with independent capability flags.
5. Verify the active layer already contains the required OAI bindings without modifying it.
6. Request takeover through an explicit local human action and a single-writer lease.
7. Calibrate one physical key at a time on black opaque caps and the frosted hero cap.
8. Release, close the handle, restart the native owner, and verify recovery.

Steps 3–8 are not implemented or accepted in 0.1.0 source.

## Prior art and licenses

Read and attribute ideas; do not paste implementations blindly.

- [Tomatio13/codex-micro-status](https://github.com/Tomatio13/codex-micro-status) — MIT; framing/status prior art.
- [eliBenven/freemicro](https://github.com/eliBenven/freemicro) — MIT; Codex Micro interoperability.
- [DevVig/microbridge](https://github.com/DevVig/microbridge) — MIT; transport and state concepts.
- [thannous/claude-codex-micro](https://github.com/thannous/claude-codex-micro) — MIT; Claude-to-board integration evidence.
- [MarlinDiary/worklouder-input-cli](https://github.com/MarlinDiary/worklouder-input-cli) — MIT; version-specific configuration controls.
- [QMK Work Louder Micro](https://github.com/qmk/qmk_firmware/tree/master/keyboards/work_louder/micro) — GPL-2.0; legacy hardware only.

MegaMicro and micro-manager were found without a clear license during the August 30, 2026 audit. They are reference-only and are not code sources for wrkpad.
