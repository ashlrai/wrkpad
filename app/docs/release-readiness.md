# Release and readiness

Passing one evidence layer never implies the next.

Desktop release tags use `agent-board-vMAJOR.MINOR.PATCH`. Core `wrkpad` tags use
`wrkpad-vMAJOR.MINOR.PATCH`; the namespaces prevent two independent component
versions from colliding.

## Readiness layers

| Layer | Required evidence | Does not prove |
| --- | --- | --- |
| Source complete | Reviewed diff, current docs, clean status | Tests passed |
| Test verified | Tests, lint, build, and relevant hardware tests pass at one full SHA | Package exists |
| Artifact built | Architecture-specific app and checksum from the verified SHA | Signing, notarization, or launch |
| Distribution ready | Signature, notarization, Gatekeeper check, provenance, rollback | Provider or physical acceptance |
| Integration configured | Apps, tools, hooks, and permissions are present | Valid runtime receipt |
| Physical accepted | Fresh Flight Check passes on the actual board and daily layer | Native RGB or firmware qualification |
| Provider accepted | Real Codex, Claude/cmux, `wrkpad`, and Fleet workflows pass | User acceptance |
| User accepted | Named workflow and usability criteria pass with a real operator | General availability |

## Local verification

From a clean checkout:

```bash
npm install
npm test
npm run lint
npm run build
npm run doctor
git diff --check
git status --short --branch
git rev-parse HEAD
```

Record the full SHA, platform, architecture, Node/npm versions, passed and skipped checks, and doctor warnings. The doctor is environment evidence and can fail when source tests pass.

## Build an unsigned artifact

```bash
npm run package:mac
find release -maxdepth 3 -type d -name '*.app' -print
```

Record an `app.asar` checksum and the exact source SHA. The command creates a directory target only; it does not create a DMG, sign, notarize, staple, upload, or update users.

The manual unsigned-preview workflow uploads the archive with a companion
manifest containing its SHA-256, exact source SHA, and explicit
`signed=false`/`notarized=false` declarations. The manifest improves preview
traceability; it is not a signature, notarization receipt, or release provenance.

## Public distribution gate

Before publishing a macOS artifact, verify:

1. Reproducible CI from the release tag.
2. Pinned supported Node and macOS versions.
3. Developer ID Application signature.
4. Apple notarization and staple.
5. Gatekeeper assessment on a clean account.
6. Checksums and provenance on the release.
7. Documented rollback target.
8. License and third-party notice review.
9. Fresh daily Flight Check and provider acceptance.
10. Privacy review of receipts and local configuration.

Signing and publication require explicit maintainer authorization. Keep credentials out of repository files, logs, issues, and release notes.

## Release record template

```text
Version/tag:
Release timestamp and verifier:
Full source SHA and dirty state:
macOS / architecture / Node / npm:
Artifact identifier and checksum:
Signature and notarization receipts:
Checks passed and skipped:
Doctor result and warnings:
Flight Check receipt ID/status:
Codex acceptance:
Claude/cmux acceptance:
wrkpad receipt acceptance:
Ashlr Fleet receipt acceptance:
Known limitations:
Rollback artifact/tag:
```

Never publish full local paths, prompts, transcripts, tokens, or raw private receipts.

## Current v0.1.0 boundary

The package version is `0.1.0`. Source and local packaging can be verified, but signing, notarization, updates, exact task/pane focus, and physical RGB are not implemented. Treat v0.1.0 as unreleased until the distribution gate has an immutable record.
