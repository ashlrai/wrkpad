# Security policy

Ashlr Agent Board is a local-first Electron application. It can inspect local
repositories, foreground agent applications, launch explicitly allowlisted
commands, and write operator-selected Flight Check receipts. Reports that cross
the renderer/main-process boundary or turn displayed agent data into command
execution are especially important.

## Supported versions

Until the project reaches `1.0.0`, security fixes are made on the default branch
and the latest tagged `0.x` release. Older prereleases may not receive patches.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting flow:

<https://github.com/ashlrai/wrkpad/security/advisories/new>

If private reporting is temporarily unavailable, contact an Ashlr AI
organization owner through GitHub and ask for a private reporting channel. Do
not include exploit details, credentials, local file contents, repository names,
agent transcripts, or Flight Check receipts in a public discussion.

Please include:

- the affected version or commit;
- operating system and architecture;
- a minimal reproduction with sensitive values removed;
- the expected and observed security boundary;
- impact and any known prerequisites; and
- suggested remediation, if available.

We aim to acknowledge complete reports within three business days and provide
an initial assessment within ten business days. These are response targets, not
a service-level agreement. Please allow a reasonable remediation window before
coordinated disclosure.

## Scope

In scope:

- Electron renderer, preload, IPC, navigation, and sandbox boundaries;
- command allowlisting, confirmation/hold controls, and workspace isolation;
- local hook/status ingestion and untrusted status text;
- receipt integrity and filesystem writes;
- packaged-app integrity and dependency supply chain; and
- unsafe interactions with Codex, Claude, cmux, Ashlr Hub, Work Louder Input,
  or the Creator Micro 2.

Generally out of scope unless they demonstrate a project vulnerability:

- physical access to an already unlocked computer;
- vulnerabilities solely in an unsupported operating system or third-party
  application;
- denial of service requiring the reporter to modify their own application
  data or source checkout; and
- social engineering, spam, or automated scanner output without a reproducible
  impact.

## Safety and privacy

Use test repositories and synthetic agent/task data. Do not write to HID devices,
approve permissions, enable Fleet authority, send prompts, or mutate a real
repository while testing. Stop if testing could affect another person or system.

Good-faith research that follows this policy, avoids privacy violations and
service disruption, and gives us time to remediate will not be pursued by Ashlr
AI under applicable anti-circumvention laws. This statement does not authorize
testing of third-party services and is not a bug-bounty promise.
