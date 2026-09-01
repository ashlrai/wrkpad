# Agent Board instructions

These instructions extend the repository-root `AGENTS.md` for files under
`app/`.

## Architecture

- `src/` is an unprivileged React renderer. It receives small validated
  snapshots through `electron/preload.cjs`; it has no Node or raw IPC access.
- `electron/main.cjs` owns windows, IPC, local process execution, filesystem
  writes, confirmation/hold enforcement, and provider adapters.
- Executors must be explicit entries in `electron/action-registry.cjs`.
  Renderer-provided commands, executables, argv, paths, and safety levels are
  never authoritative.
- `scripts/doctor.mjs` and the root agent preflight are read-only evidence
  collectors. A generic doctor pass does not mean either board route is ready.

## Implementation rules

- Keep Codex Native and Ashlr Layer as separate route contracts.
- Preserve bounded output, fixed executable lookup, argv execution, timeouts,
  navigation denial, sandboxing, context isolation, and schema validation.
- New local writes must use new private files or an existing guarded atomic
  lifecycle. Never mutate Input's database/cache or the device.
- Do not add prompt submission, exact task/pane claims, or one-press
  consequential actions.
- Add text/icon state for every color state and keyboard-accessible behavior for
  every pointer interaction.

## Verification

Run from `app/`:

```bash
npm run lint
npm test
npm run build
npm audit --audit-level=high
```

Run `npm run package:mac` only when packaging behavior changed. It creates an
unsigned local directory build; it does not install, sign, notarize, publish, or
prove physical acceptance.
