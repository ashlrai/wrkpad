@AGENTS.md

## Claude Code

- Run `/context` when instruction loading is uncertain; this file imports the
  same project contract used by Codex.
- Claude Code lifecycle hooks can populate HASP. Claude Desktop chats do not
  expose the same hook contract, and cmux focus is application-level rather than
  exact-pane proof.
- Do not rewrite `.claude/settings.json`; its Entire hooks are optional
  contributor tooling. wrkpad hook changes must use the guarded status, plan,
  and apply lifecycle and must preserve unrelated handlers.
- Project-specific private settings belong in ignored
  `.claude/settings.local.json`, never in tracked instructions.
