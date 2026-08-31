# Contributing

Thank you for improving wrkpad. The project welcomes provider adapters, hardware evidence, accessibility work, tests, documentation, and conservative protocol implementations.

## Before opening a change

1. Read the [architecture](docs/architecture.md), [HASP contract](protocol/hasp.md), and [device interoperability boundary](protocol/device-interoperability.md).
2. Open or reference an issue for changes to schemas, occupancy, persistence, HID, security, or physical mappings.
3. Keep one behavior change per pull request where practical.
4. Do not include credentials, raw transcripts, prompts, real customer data, HID serial numbers, or unredacted local paths.

## Development checks

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-targets
cargo build --release
```

Add tests for every reducer transition, parser edge case, protocol frame, or safety gate you change. A hardware change also needs a fake-transport fixture; physical success alone is not reproducible evidence.

## Protocol and hardware contributions

- Name the exact VID/PID, strings, transport, descriptor digest, firmware, active layer, and host OS.
- Distinguish an OS write, correlated RPC response, visible result, cleanup, and reconnect acceptance.
- Redact serials and full device paths by default.
- Do not add bootloader, firmware, keymap, profile, or arbitrary filesystem mutations to normal commands.
- Do not copy from a repository without a compatible license.
- Mark community reverse engineering as such; do not present it as a vendor guarantee.

## Commit policy

Use concise imperative commit messages. Sign off commits with `git commit -s` to certify the Developer Certificate of Origin 1.1. wrkpad uses the MIT license and does not require a contributor license agreement.

## Definition of done

A change is complete when source, tests, documentation, examples, and error behavior agree. Green CI proves only the checked source artifact; it does not prove a public release, installed hook, hardware takeover, or physical acceptance.

