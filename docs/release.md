# Release and readiness

## Release layers

Keep these facts independent:

1. Source checks passed.
2. A release binary built.
3. The binary was signed and notarized where required.
4. A public immutable artifact was published.
5. A hook configuration was installed from that stable binary.
6. The provider trusted and invoked the exact hook definition.
7. HASP was available and ingested a disposable runtime event without private content.
8. A physical USB/HID device tuple was present and shadow-qualified.
9. Lighting takeover/release passed visibly on the named caps.
10. An operator accepted the daily workflow.

One layer never proves the next.

## Candidate procedure

From a clean checkout of the intended commit:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
wrkpad doctor --json
wrkpad doctor --dump-hid
wrkpad demo --json
```

Also run dependency advisory and license checks when the required tools are installed. Do not install or bypass a missing release tool silently; record it as skipped.

Before publishing, record:

- full source SHA and dirty state;
- Rust toolchain and target triple;
- binary SHA-256 and size;
- signing/notarization identity and receipt;
- SBOM and advisory results;
- passed and skipped platform tests;
- default feature/capability flags;
- known device tuples and whether each is discovery-only, shadow-qualified, or lighting-accepted;
- rollback artifact.

For each intended provider and scope, also record the read-only hook status, content-bound plan, applied target and private backup, preservation of unrelated hooks, provider trust result, and one disposable fired-event receipt. Inspect both stdout and persisted state to confirm prompts, assistant content, tool data, transcript paths, credentials, and approval decisions are absent.

A foreground `wrkpad serve` test proves only that process lifetime. Separately record the content-bound service plan, stable executable SHA-256, owned plist, loaded status, and authenticated health after the originating terminal closes. Hook installation alone does not keep HASP running.

## Hardware claim rule

A release may say “discovers Creator Micro 2/Codex Micro candidates” when doctor fixtures and live enumeration support it. It may say “hardware lighting supported” only for exact tuples with visible calibration, release, reconnect, and soak evidence in the release ledger.

Unknown devices remain observe-only.

## Connected desk snapshot

The August 31, 2026 desk snapshot proves discovery, not lighting support:

- Work Louder Creator Micro 2 `303A:8298`, USB, six HID collections;
- IORegistry descriptor: 275 bytes, SHA-256 `9257d7361f9c784e0fc0b260bbac0feadd49bf79cbb6202d6c41560cbae96fb6`;
- descriptor source was the macOS registry; no HID handle was opened and no report was sent;
- raw USB device version `0x39C0` is retained only as a non-semantic value;
- current Input log firmware response: `v0.1.50`;
- `device.status` and `v.oai.rgbcfg`: `Method not found`.

Re-capture every item after an official firmware update. Never reuse this descriptor or firmware evidence as acceptance for a different desk, device, or release.
