# Release and readiness

## Release layers

Keep these facts independent:

1. Source checks passed.
2. A release binary built.
3. The binary was signed and notarized where required.
4. A public immutable artifact was published.
5. Hooks were installed and trusted in a specific provider/version.
6. A physical device tuple was shadow-qualified.
7. Lighting takeover/release passed.
8. An operator accepted the daily workflow.

One layer never proves the next.

## Candidate procedure

From a clean checkout of the intended commit:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
wrkpad doctor --json
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

## Hardware claim rule

A release may say “discovers Creator Micro 2/Codex Micro candidates” when doctor fixtures and live enumeration support it. It may say “hardware lighting supported” only for exact tuples with visible calibration, release, reconnect, and soak evidence in the release ledger.

Unknown devices remain observe-only.

