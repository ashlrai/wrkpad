# Contributing to Ashlr Agent Board

Thank you for helping make physical agent workflows clearer, safer, and more accessible.

## Before you start

Open an issue before changing a hardware protocol, trust boundary, state grammar, provider adapter, or consequential action. Describe the user problem, proposed behavior, alternatives, and evidence you can collect. Small bug fixes, tests, and documentation corrections can go directly to a pull request.

By participating, you agree to follow the repository [Code of Conduct](../CODE_OF_CONDUCT.md).

## Development setup

Requirements:

- macOS
- Node.js 22 or newer and npm
- A Creator Micro 2 for physical acceptance; most unit tests do not require hardware
- Work Louder Input for real shortcut mapping

```bash
git clone https://github.com/ashlrai/wrkpad.git
cd wrkpad/app
npm install
npm run doctor
npm test
```

The doctor is read-only. It cannot grant macOS permissions, configure Input, install tools, or validate physical routing.

### Optional Entire session capture

Maintainers use [Entire](https://entire.io/) to associate selected AI coding sessions with commits. Entire is optional developer tooling: it is not required to install, build, test, package, or run Agent Board. The checked-in Claude hooks first verify that the `entire` executable exists, so contributors without it do not receive hook failures.

The repository keeps session capture enabled for maintainers who explicitly install Entire, while product telemetry is disabled by default. Personal overrides belong in ignored `.entire/settings.local.json`; logs and captured metadata remain untracked. Do not install Entire, enable telemetry, rewrite Git hooks, or restore a checkpoint on another contributor's behalf. `entire status --detailed` is the safe read-only configuration check.

## Make a focused change

1. Create a branch for one behavior.
2. Inspect the existing action registry, schemas, and tests before editing.
3. Preserve the invariants in [architecture and trust](docs/architecture.md).
4. Add tests for success, malformed input, denial, and recovery where applicable.
5. Update canonical documentation when setup, controls, integrations, or readiness change.
6. Run the local checks.

```bash
npm test
npm run lint
npm run build
git diff --check
```

If hardware behavior changed, also complete the relevant [Flight Check](docs/setup.md#run-flight-check) and attach a redacted receipt summary. Do not commit receipts: they can contain local timestamps, workspace context, and device observations.

## Pull request checklist

- [ ] The change solves one clearly stated problem.
- [ ] Tests cover important failure and recovery paths.
- [ ] Renderer inputs remain bounded and sanitized.
- [ ] No secret, prompt, transcript, session identifier, or private path is exposed.
- [ ] New executors are allowlisted in the Electron main process.
- [ ] Consequential actions retain confirmation or continuous hold as appropriate.
- [ ] Flight Check still suppresses mapped actions in the main process.
- [ ] UI state is communicated with text or icons, not color alone.
- [ ] Documentation reflects current behavior and names remaining limitations.
- [ ] Source, build, package, activation, and physical acceptance are not conflated.

Include commands run and results in the pull request. If a check was skipped, explain why.

All commits must be signed off under the repository's Developer Certificate of
Origin policy. Contributions inside `app/` are Apache-2.0; files outside `app/`
are MIT unless a file says otherwise. The project does not require a contributor
license agreement.

## Hardware and provider changes

A USB descriptor, firmware version, device claim, RGB transport, and successful physical route are separate facts. Do not infer one from another.

Provider integrations must:

- use documented or empirically verified contracts;
- fail closed on malformed or ambiguous data;
- preserve the provider's native approval model;
- avoid sending prompts or terminal input during focus;
- state whether focus is app-level, task-level, or pane-level;
- include privacy and timeout tests.

Do not add silent repository sync, permission changes, credential discovery, or release side effects to lifecycle hooks.

## Style

- Prefer small, typed interfaces and explicit state names.
- Use sentence-case headings and plain language.
- Make controls understandable from their hardware ID and visible consequence.
- Avoid claims such as “connected,” “ready,” or “complete” without naming the evidence layer.
- Do not commit generated `release/` or `dist-renderer/` output.

## Reporting security issues

Do not open a public issue for a vulnerability. Use the repository's **Security → Report a vulnerability** flow when available. If private vulnerability reporting is unavailable, contact [hello@ashlr.ai](mailto:hello@ashlr.ai) with the repository name and a minimal reproduction. Do not include live credentials or private user content.
