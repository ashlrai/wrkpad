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
| Integration configured | Route-specific controller checks pass: verified Input and one Agent Board receiver for Ashlr Layer, or Input closed with Codex as the sole intended controller for Codex Native; apps, tools, hooks, and permissions are present | Exclusive HID ownership, valid shortcut, provider, or physical receipt |
| Physical accepted | Fresh Flight Check passes on the actual board and daily layer | Native RGB or firmware qualification |
| Provider accepted | Real Codex, Claude/cmux, `wrkpad`, and Fleet workflows pass | User acceptance |
| User accepted | Named workflow and usability criteria pass with a real operator | General availability |

## Local verification

From a clean checkout:

```bash
cd wrkpad/app
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

For hardware acceptance, also record these independent local gates:

- A human confirmed the Creator Micro 2 Pro's fourth **WIRED** communication
  channel by white underglow. This is mode evidence only, not USB acceptance.
- Before an Input-controlled operation, Setup reported **Input … · publisher,
  signature, and Gatekeeper verified**. For Codex Native, record that Input was
  stopped and preserve its integrity result as a separate future-operations
  gate. Record only sanitized status and version, never raw signing output or
  app paths.
- Setup reported **One receiver · shortcut ownership available**. If it was
  contended, a human used Command-Q to fully quit all Agent Board copies and
  relaunched one intended build; no process was killed automatically.
- The September 2 desk update installed firmware `0.6.2` and the board accepted
  both required Codex methods. Input then repeated its known sealed-resource
  mutation. Native consumption, visible lighting, and post-update Flight Check
  remain pending; see the canonical
  [post-flash evidence](../../docs/creator-micro-2-post-flash-2026-09-02.md).

These gates do not prove one another, a current Input profile, Input Monitoring,
device synchronization, native Codex RPC success, provider receipt, or physical
acceptance.

## Build an unsigned artifact

```bash
npm run package:mac
find release -maxdepth 3 -type d -name '*.app' -print
```

Record an `app.asar` checksum and the exact source SHA. The command creates a directory target only; it does not create a DMG, sign, notarize, staple, upload, or update users.

The manual unsigned-package audit builds on an ephemeral GitHub runner and
checks the bundle identifier, version, architecture, source SHA, `app.asar`
checksum, and expected `developer_id_signed=false`/`notarized=false` state. It does not
upload an application archive or publish an installable binary. Its temporary
manifest is diagnostic evidence only, not a signature, notarization receipt,
release artifact, or provenance attestation.

## Local preview install or update

The preview has no automatic updater. Before replacing a local preview, record
its source SHA and `app.asar` checksum, then have the operator use Command-Q to
fully quit every Ashlr Agent Board copy. Move the new build to one intended
location and reopen only that copy. Do not use an agent to kill processes or
delete the prior build; keep the prior verified artifact as rollback until the
new build passes Setup and Flight Check.

After launch, require **One receiver · shortcut ownership available** and verify
the exact receiver manually in **System Settings → Privacy & Security → Input
Monitoring**. A matching `app.asar` hash identifies bytes only; it does not prove
Developer ID signing, notarization, permission, shortcut receipt, or physical
acceptance. An unsigned preview is still not distribution ready.

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
Input installation sanitized status/version:
Receiver status and bounded build count:
Wired-mode white-underglow confirmation:
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
