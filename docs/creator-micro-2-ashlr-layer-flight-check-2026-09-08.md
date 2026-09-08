# Creator Micro 2 sealed Ashlr Layer acceptance — September 8, 2026

This is a dated, one-desk evidence record. It must not be reused as acceptance
for another board, profile, receiver build, shortcut route, or later runtime.

## Result

Between 6:13 PM and 6:14 PM EDT on September 8, 2026, a Creator Micro 2
separately observed on this desk as `303A:8298` completed a fresh Agent Board
**Ashlr Layer** Flight Check. The operator attested that only the physical board
was used during the ordered sequence; the shortcut receiver cannot independently
prove physical-device causality.

| Evidence | Observed result |
| --- | --- |
| Ordered physical controls | 20/20 signals and 20/20 gestures |
| Accepted Flight callbacks | 24 (dial left and right each require three detents) |
| Probable duplicate edges suppressed | 0 |
| Misroutes | 0 |
| Dropped suppression records | 0 |
| Registered shortcut endpoints | 20/20 |
| Receiver ownership | Exclusive; one receiver and one build |
| Safety state during the run | Ashlr actions suppressed; native path untouched |
| Work Louder Input | v0.18.4 publisher/signature/Gatekeeper verified; observed not running at receipt checks |
| Agent Board | v0.2.0, `app.asar` SHA-256 `e12a458ecf2cb8e580777247bcfcf15bc992dbabb481c7c3819dda3f8eacfefd` |

ACT10 and ACT11 each produced an independent physical event. The run started at
`2026-09-08T22:13:58.206Z` and the receipt was exported at
`2026-09-08T22:14:51.519Z`.

## Sealed receipt

The main process re-evaluated the active Flight session and wrote a private
mode-`0600` receipt under the application's local data directory:

| Receipt field | Value |
| --- | --- |
| Schema | `ai.ashlr.agent-board.flight-check/v2` |
| Status | `passed` |
| Receipt ID | `db35b4c6-bceb-4300-9de2-d8b4663dc4c5` |
| Receipt SHA-256 | `4ff3860a8c36dc90c47fa08947761fc69957cde2cd785e0f8644d14dbaf06c1a` |
| Independent hash recomputation | Match |

The receipt contains 24 accepted raw events, zero problems, zero suppressed
duplicates, and zero dropped suppression records. Its SHA was independently
recomputed by removing the stored `sha256` field and hashing the canonical
`JSON.stringify` payload; the digest matched exactly. The private filename and
local user path are intentionally omitted from this public record.

## What this clears

This clears the Ashlr Layer shortcut-routing gate for this exact desk, profile,
installed receiver build, and run, subject to the operator's physical-use
attestation. It proves that all expected global shortcuts were observed in order
while the device-class USB-presence gate, verified Input installation, and 20
registered endpoints were present.

After the receipt was saved, **Start operating** was separately observed to
release the interlock. That UI action is not part of the sealed receipt.

## What remains separate

This does not prove:

- cryptographic device identity or exclusive USB/HID causality;
- Codex Desktop native Agent-key focus, thread selection, or RGB behavior;
- exact Claude Code task selection or cmux pane selection;
- Hybrid Native's combined 14-gesture plus six-native-key contract;
- provider hook invocation, fleet dispatch, or consequential-action authority;
- Developer ID signing, notarization, updater delivery, or public distribution.

The installed app is a locally built, ad-hoc-signed preview. Source tests and
this one-desk receipt are separate from a generally distributable release.
