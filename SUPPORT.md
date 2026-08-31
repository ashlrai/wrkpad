# Support

## Start here

- Core CLI, hook, HASP, service, or device evidence: run `wrkpad doctor`, then
  read [hook setup](docs/hook-setup.md), [macOS service](docs/macos-service.md),
  and [ownership and recovery](docs/ownership-and-recovery.md).
- Agent Board UI, shortcuts, Flight Check, Codex, Claude/cmux, or Fleet briefing:
  use the [desktop support guide](app/SUPPORT.md) and
  [troubleshooting guide](app/docs/troubleshooting.md).
- Security: follow [SECURITY.md](SECURITY.md) and never post vulnerability details
  publicly.

Use GitHub Discussions for setup questions and early ideas. Use Issues for a
reproducible bug or scoped feature. Include OS, architecture, exact commit or
version, redacted doctor output, expected and actual behavior, and whether the
problem affects source, package, integration, provider receipt, or physical
acceptance.

Never post credentials, tokens, prompts, transcripts, customer data, private
repository names, full local paths, device serial numbers, or unredacted receipts.

## Current support boundary

The core supports read-only discovery, local status, guarded hooks/service, and a
TUI on supported desktop systems. Agent Board supports macOS development and
unsigned local packaging. Physical RGB, firmware writes, exact provider task/pane
focus, automatic provider installation, signed distribution, and remote Fleet
authority are not supported.
