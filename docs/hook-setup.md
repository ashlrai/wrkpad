# Claude Code and Codex hook setup

Hooks are optional local observers. They never approve, deny, block, continue, or modify an agent turn. Configuration, provider trust, provider invocation, HASP ingestion, and physical board painting are separate facts; none proves the next.

## Prerequisites

1. Install or copy a stable `wrkpad` binary. From a reviewed source checkout,
   run `cargo install --path . --locked --root "$HOME/.local"`. Do not configure
   hooks from `target/release`: `cargo clean` can invalidate that path, and
   ownership is bound to the exact executable path and SHA-256.
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

The managed Claude set contains fourteen synchronous, two-second handlers:

- `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, and `SessionEnd` map ordinary lifecycle progress. A `Stop` with non-empty `background_tasks` or `session_crons` remains working; task commands, descriptions, prompts, and identifiers are discarded.
- `SubagentStart` maps to working and `SubagentStop` maps to unread using a distinct private subagent identity. Agent type, prompt, response, and transcript fields are discarded.
- `PermissionRequest` and `Elicitation` map immediately to `needs_input`. Auto-mode `PermissionDenied` maps to unread for review because it does not create a user approval prompt. wrkpad never returns an approval, retry, or elicitation response.
- `ElicitationResult` maps back to working. MCP server names, URLs, schemas, elicitation identifiers, actions, and response content are discarded.
- `Notification(permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input)` maps to `needs_input`.
- `Notification(idle_prompt|agent_completed)` maps to unread.
- `PostToolUseFailure` and `StopFailure` map to error.

The wrkpad HTTP deadline is 200 ms. Synchronous ordering is intentional; do not add `async: true` if ordered state transitions are required.

## Codex CLI signals and trust

The managed Codex set contains eight handlers: `SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `Stop`, `SubagentStart`, `SubagentStop`, and `SessionEnd`.

Subagents use `parent session + agent_id` as distinct private identities. Start maps to working and stop maps to unread, so parallel subagents can occupy distinct sticky slots and reach the normal six-slot overflow policy.

After any install or repair, open Codex `/hooks`, inspect the full command and source, and explicitly trust each exact wrkpad definition. Codex records trust per normalized hook definition and current hash, not once for the entire JSON file. If `wrkpad hooks status` reports unrelated handlers, choose **Review hooks** and trust only the eight commands ending `--managed-by dev.wrkpad.hook-v1`, one at a time. Never choose **Trust all and continue** in that state; leave every unrelated handler untrusted. `wrkpad hooks status` reports trust as `untrusted_or_unknown`; it cannot inspect or change Codex trust. Do not normalize `--dangerously-bypass-hook-trust` into setup instructions.

Project-scoped hooks are additive and do not suppress user-scoped hooks, so copying wrkpad into `.codex/hooks.json` is not an isolation mechanism. Keep the stable user-scoped definitions and use Codex's per-hook review boundary.

`PermissionRequest` is the lifecycle hook for an imminent approval prompt. `approval-requested` is a TUI notification selector, `agent-turn-complete` is the legacy external `notify` payload, and `approval-required` is not the managed lifecycle event.

## Unrelated hook review

`wrkpad` preserves unrelated hooks and does not authorize them. Review every
unmanaged command, timeout unit, working-directory assumption, and mutation
before granting provider trust. Leave commands that fetch, pull, write files,
start network services, or invoke unknown scripts untrusted until an operator
has separately approved their exact behavior.

## Runtime verification

With HASP available, start a disposable agent session and inspect:

```bash
wrkpad status --json
```

Verify a slot changes and that prompt text, assistant content, tool commands and arguments, transcripts, credentials, and approval decisions are absent from stdout and the state file. A configured and trusted hook still does not prove the provider invoked it; an ingested event still does not prove the board was painted.

For the lowest-risk Codex receipt check, first record the current revision and slot timestamps, then start Codex from an existing non-Git directory such as `/tmp`. In `/hooks`, trust only the eight exact wrkpad definitions and leave every unrelated handler untrusted. Exit and start one fresh disposable session from `/tmp`, then compare `wrkpad status --json` with the baseline. This prevents foreign repository hooks from receiving trust and gives them no repository to mutate. Starting a provider session can still create provider-local session metadata and consume service quota, so it remains an explicit operator acceptance step rather than an unattended installer action.
