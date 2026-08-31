# Claude Code and Codex hook setup

Hooks are optional local observers. They do not approve, deny, block, continue, or modify an agent turn.

## Prerequisites

1. Build `wrkpad` and run `wrkpad init`.
2. Start `wrkpad serve`.
3. Resolve the absolute binary path with `realpath target/release/wrkpad`.
4. Back up the settings file you intend to edit.
5. Review existing hooks and preserve unrelated definitions.

Examples are in [`examples/claude-hooks.json`](../examples/claude-hooks.json) and [`examples/codex-hooks.json`](../examples/codex-hooks.json). Replace `/absolute/path/to/wrkpad` before merging.

## Claude Code

Claude hooks belong inside a `hooks` object in a settings file, not `.claude/hooks.json`. Recommended v0.1 signals:

- `SessionStart`
- `UserPromptSubmit`
- `Notification` with `permission_prompt`
- `PostToolUse`
- `PostToolUseFailure`
- `Stop`

Use a two-second vendor hook timeout. The wrkpad network attempt itself is limited to 200 ms. The adapter emits no stdout and exits successfully when HASP is unavailable.

After merging, inspect `/hooks`. In an untrusted repository, start Claude with hooks disabled or `--bare` until repository settings are reviewed.

## Codex CLI

Current Codex uses lifecycle hooks such as `PermissionRequest` and `Stop` in `.codex/hooks.json`. These names are distinct:

- `PermissionRequest` — modern lifecycle hook for an imminent approval prompt;
- `approval-requested` — TUI notification selector, not a lifecycle hook;
- `agent-turn-complete` — legacy external `notify` payload;
- `approval-required` — not a documented Codex event.

After merging, open `/hooks`, inspect the full command and source, and explicitly trust it. A hook definition change should require trust review again. Do not normalize `--dangerously-bypass-hook-trust` into setup instructions.

## Existing local timeout warning

The August 30 audit found an unrelated shared `SessionStart` hook configured with `"timeout": 15000` on this Mac. Both vendors interpret timeout as seconds, so that means about 4.2 hours rather than 15 seconds. wrkpad did not modify it. Review it independently before relying on hook shutdown behavior.

## Verification

With `wrkpad serve` running, start a disposable agent session and inspect:

```bash
wrkpad status --json
```

Verify that slot state changes while prompt text, assistant content, commands, and transcripts are absent from the output and state file. Hook installation does not prove a board was painted.

