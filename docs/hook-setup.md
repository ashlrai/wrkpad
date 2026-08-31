# Claude Code and Codex hook setup

Hooks are optional local observers. They never approve, deny, block, continue, or modify an agent turn. Configuration, provider trust, provider invocation, HASP ingestion, and physical board painting are separate facts; none proves the next.

## Prerequisites

1. Install or copy a stable `wrkpad` release binary. Do not configure hooks from `target/release`, because `cargo clean` can invalidate that path.
2. Run `wrkpad init` and keep HASP available with the guarded macOS [background service](macos-service.md) or a foreground `wrkpad serve`. Hooks fail open and drop the status event within the 200 ms network deadline when HASP is unavailable.
3. Review the target reported by `wrkpad hooks status`. Project scope resolves to the enclosing Git root and contains a machine-specific absolute executable path; never commit it.

The files in [`examples/`](../examples/) show the canonical shape only. Do not paste them over an existing settings file.

## Guarded lifecycle

Run the stable binary for every step:

```bash
wrkpad hooks status --provider codex --scope user
wrkpad hooks plan --provider codex --scope user --action install --json
wrkpad hooks install --provider codex --scope user --confirm <exact-plan-id>
```

Repeat with `--provider claude`. Use project scope only when the repository-specific behavior is intentional.

The confirmation ID binds the source hash and exact proposed document. Apply takes a private per-target lock, rechecks the file immediately before an atomic replacement, refuses target and parent symlinks, preserves unrelated handlers and file mode, and backs up an existing target beneath the private wrkpad `hook-backups` directory. A concurrent non-wrkpad writer cannot honor the advisory lock, so re-inspect the resulting settings after any simultaneous vendor edit.

- `install` adds missing managed handlers and refuses stale or duplicate wrkpad handlers.
- `repair` replaces only ownership-marked wrkpad handlers; it will not bootstrap an unconfigured target.
- `uninstall` removes only ownership-marked wrkpad handlers and leaves other settings intact.

The manager uses an exact `--managed-by dev.wrkpad.hook-v1` command marker. Similar unmarked commands are treated as unrelated and are never deleted.

## Claude Code signals

The managed Claude set contains nine synchronous, two-second handlers:

- `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, and `SessionEnd` map ordinary lifecycle progress.
- `PermissionRequest` maps immediately to `needs_input`.
- `Notification(permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input)` maps to `needs_input`.
- `Notification(idle_prompt|agent_completed)` maps to unread.
- `PostToolUseFailure` and `StopFailure` map to error.

The wrkpad HTTP deadline is 200 ms. Synchronous ordering is intentional; do not add `async: true` if ordered state transitions are required.

## Codex CLI signals and trust

The managed Codex set contains eight handlers: `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`, and `SessionEnd`.

Subagents use `parent session + agent_id` as distinct private identities. Start maps to working and stop maps to unread, so parallel subagents can occupy distinct sticky slots and reach the normal six-slot overflow policy.

After any install or repair, open Codex `/hooks`, inspect the full command and source, and explicitly trust the exact definition. `wrkpad hooks status` reports trust as `untrusted_or_unknown`; it cannot inspect or change Codex trust. Do not normalize `--dangerously-bypass-hook-trust` into setup instructions.

`PermissionRequest` is the lifecycle hook for an imminent approval prompt. `approval-requested` is a TUI notification selector, `agent-turn-complete` is the legacy external `notify` payload, and `approval-required` is not the managed lifecycle event.

## Existing local timeout warning

The August 31 audit found an unrelated shared `SessionStart` hook configured with `"timeout": 15000` on this Mac. Both providers interpret timeout as seconds, so that is about 4.2 hours rather than 15 seconds. wrkpad preserves it. Review it independently.

## Runtime verification

With HASP available, start a disposable agent session and inspect:

```bash
wrkpad status --json
```

Verify a slot changes and that prompt text, assistant content, tool commands and arguments, transcripts, credentials, and approval decisions are absent from stdout and the state file. A configured and trusted hook still does not prove the provider invoked it; an ingested event still does not prove the board was painted.
