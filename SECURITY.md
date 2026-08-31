# Security policy

`wrkpad` combines a native local status service with the optional Ashlr Agent
Board desktop app. Vulnerabilities that cross hook, localhost, renderer, process,
filesystem, device, or approval boundaries are especially important.

## Report a vulnerability privately

Do not open a public issue. Use GitHub private vulnerability reporting:

<https://github.com/ashlrai/wrkpad/security/advisories/new>

If that flow is unavailable, email [hello@ashlr.ai](mailto:hello@ashlr.ai) and
ask for a private reporting channel. Do not send credentials, live tokens,
prompts, transcripts, customer data, private repository names, full local paths,
serial numbers, or unredacted Flight Check receipts.

Include the affected component and commit, operating system and architecture, a
minimal redacted reproduction, expected and observed trust boundary, impact,
and known prerequisites. We aim to acknowledge complete reports within three
business days and provide an initial assessment within ten business days. These
are response targets, not a service-level agreement or bug-bounty promise.

## Supported scope

Until component-specific signed release policies exist, security fixes target
the current `main` branch and latest namespaced prerelease tag. Core releases use
`wrkpad-v*`; desktop releases use `agent-board-v*`.

In scope includes:

- provider hook parsing, redaction, configuration, and ownership;
- HASP authentication, loopback binding, persistence, and session isolation;
- service lifecycle and local executable identity;
- USB/HID discovery, occupancy transitions, and any future writable adapter;
- Electron renderer, preload, IPC, navigation, sandbox, and CSP boundaries;
- command allowlisting, confirmation/hold controls, workspace isolation, and
  receipt integrity; and
- dependency, package, signing, and release supply-chain behavior.

See [the desktop supplement](app/SECURITY.md) and the retained
[core](.security/audit-2026-08-31.md) and
[desktop](app/.security/audit-2026-08-31.md) audit reports.

## Trust boundaries and invariants

- Provider hook JSON is untrusted and privacy-sensitive.
- The HASP bearer token protects data from browsers and other local accounts,
  not malware running as the same user.
- Normal HASP is authenticated loopback-only and has no approval or agent-control
  endpoint.
- The hook client refuses non-loopback endpoints.
- Hook installation is content-bound, ownership-marked, backup-preserving,
  symlink-refusing, and distinct from provider trust.
- The macOS service is per-user, fixed to loopback and direct argv, and refuses
  foreign or ambiguous configuration.
- Device evidence is exact-version gated. VID/PID or process absence alone never
  authorizes writes or proves exclusive ownership.
- Current source performs no HID, keymap, profile, firmware, or bootloader writes.
- Agent Board exposes allowlisted action IDs only. Consequential actions require
  confirmation or a continuous main-process hold.
- No one-press push, merge, deploy, publish, delete, spend, credential, or
  permission-approval executor belongs in the project.
- Status and UI output must not log prompts, assistant content, tool input/output,
  transcript paths, credentials, authorization headers, or raw private payloads.

## Safe research

Use synthetic repositories, sessions, and device data. Do not approve permissions,
send prompts, enable Fleet authority, write to HID hardware, or mutate another
person's system while testing. Good-faith research that follows this policy,
avoids privacy violations and disruption, and allows a reasonable remediation
window will not be pursued by Ashlr AI under applicable anti-circumvention laws.
This does not authorize testing third-party services.
