# Creator Micro 2 Ashlr Layer acceptance — September 5, 2026

This is a dated, one-desk evidence record. It must not be reused as acceptance
for another board, profile, receiver build, or shortcut route.

## Result

At 12:12 AM EDT on September 5, 2026, the Creator Micro 2 enumerated as
`303A:8298` completed the Agent Board **Ashlr Layer** Flight Check:

| Evidence | Observed result |
| --- | --- |
| Ordered physical controls | 20/20 signals and 20/20 gestures |
| Raw macOS shortcut callbacks | 24 (dial left and right each require three detents) |
| Misroutes | 0 |
| Registered shortcut endpoints | 20/20 |
| Receiver ownership | Exclusive; one receiver |
| Safety state during the run | Ashlr actions suppressed; native path untouched |
| Input profile | `Ashlr Agent Board Corrected` / `Ashlr Daily` |
| Agent Board | v0.2.0, `app.asar` SHA-256 `58026c40425a69bdcac1394ebf9c0b10b852b814b6ee72268954d6ec5873090d` |

ACT10 and ACT11 each produced an independent physical event. The operator kept
ordinary keyboard and pointing-device input out of the acceptance sequence.

## Persistence boundary

The completed live run was visually observed and captured, but its macOS save
sheet did not enable **Save**. Therefore this record is **user-attested live
acceptance**, not a persisted, machine-sealed Flight receipt. It has no receipt
ID or receipt SHA-256. Do not project it as durable commissioner readiness.

The subsequent source revision replaces the save sheet with a one-click private
local save, renders only the receipt filename, rejects stale completion evidence,
and withholds **Start operating** until saving succeeds. That revised receiver
build requires its own fresh physical Flight Check after installation.

## What this clears

This clears the Ashlr Layer physical shortcut-routing gate for this exact desk,
profile, and receiver build. It proves that the expected global shortcuts were
observed in order while the USB identity and all endpoints were present.

## What remains separate

This does not prove:

- cryptographic device identity or exclusive USB/HID causality;
- Codex Desktop native Agent-key focus, thread selection, or RGB behavior;
- exact Claude Code task selection or cmux pane selection;
- Hybrid Native's combined 14-gesture plus six-native-key contract;
- provider hook invocation, fleet dispatch, or consequential-action authority;
- signed, notarized, or generally distributed application readiness.

For the earlier firmware and protocol evidence, see the
[September 2 post-flash record](creator-micro-2-post-flash-2026-09-02.md).
