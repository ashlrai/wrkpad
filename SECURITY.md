# Security policy

## Reporting a vulnerability

Before a public repository exists, report vulnerabilities privately to the Ashlr project operator. After publication, use the repository's private security advisory flow. Do not open a public issue for a vulnerability that exposes local tokens, agent data, arbitrary command execution, approval interception, unsafe HID writes, or cross-origin localhost access.

Include the affected version or commit, operating system, exact reproduction, impact, and whether hardware or agent credentials were exposed. Do not attach real credentials, transcripts, or customer data.

## Supported scope

Version 0.1 is pre-release software. Security fixes target the current `main` branch until the first signed release policy is established.

## Trust boundaries

- Provider hook JSON is untrusted and privacy-sensitive.
- The bearer token protects session data from browsers and other local accounts, not malware running as the same user.
- HASP is loopback-only and has no approval or agent-control endpoint.
- The hook client refuses non-loopback endpoints so it cannot transmit the bearer token to an external host.
- Device protocol evidence is reverse engineered and exact-version gated.
- HID writes are absent from current source.
- Process absence is not proof of exclusive device ownership.
- Hook configuration is executable user configuration; installation and vendor trust are human-reviewed steps.
- Hook mutation is scoped by an exact ownership marker, a content-bound confirmation plan, private backup, symlink refusal, and atomic replacement. It never claims or changes provider trust.
- The macOS service is per-user, fixed to loopback, direct argv, and a recognized plist. It contains no token or environment and refuses foreign files, disabled labels, custom state roots, and unmanaged authenticated listeners.

## Security invariants

Pull requests must not:

- log prompts, assistant messages, tool input/output, transcripts, credentials, or Authorization headers;
- bind normal HASP mode to wildcard or non-loopback addresses;
- permit browser Origin headers by default;
- add allow/deny/block responses to hook adapters;
- enable HID writes from VID/PID or minimum firmware alone;
- blur observe, shadow, takeover, and release;
- silently kill competing applications or alter OS permissions.
- follow symlinked token or persisted-state files.
- delete unmarked or unrelated vendor hook handlers during repair or uninstall.
