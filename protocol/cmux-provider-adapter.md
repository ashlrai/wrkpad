# cmux provider adapter contract

Status: the fixed-path, capability-negotiated adapter substrate is implemented
and source-tested. Locator capture, one-use human authorization issuance, and
socket-password enrollment are not implemented, so installed Agent Board builds
cannot take the exact-focus branch and do not claim exact cmux workspace, pane,
or surface focus.

## Evidence baseline

The local reference inspected on September 3, 2026 is cmux `0.62.2` build `77`
(`6c203b514`) at the fixed application-bundle CLI path:

```text
/Applications/cmux.app/Contents/Resources/bin/cmux
```

Its socket-free version and help output expose `capabilities`, `identify`,
`select-workspace`, and `focus-panel`. Its managed terminal environment documents
`CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, `CMUX_SOCKET_PATH`, and
`CMUX_SOCKET_PASSWORD`. The [upstream CLI contract][cli-contract] and [upstream
workspace command reference][command-reference] are the canonical moving
references; the version above is a local compatibility observation, not a minimum
supported version promise.

From a process outside cmux, both `capabilities --json` and `identify --json`
returned `Access denied — only processes started inside cmux can connect`. That
denial is a valid capability result. It must not be retried as a different verb,
bypassed with terminal automation, or misreported as an absent cmux installation.

## Locator capture

Claude Code hooks launched inside a cmux terminal may read
`CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID` from their inherited environment. The
hook adapter must:

1. accept both values only as bounded, printable locator strings and prefer
   stable UUID forms over process-local numeric references;
2. associate them with the Claude provider and the current provider session;
3. include provider, provider-session ID, workspace locator, and surface locator
   in a token-keyed HMAC binding before any durable association;
4. keep raw locators out of HASP events, snapshots, renderer IPC, logs, receipts,
   analytics, crash reports, and CLI output;
5. retain raw locators, if persistence is enabled, only in a separate user-private
   mode-`0600` local registry needed for focus resolution; and
6. delete the association on `SessionEnd`, explicit slot forget, failed locator
   validation, or a changed cmux server identity.

`CMUX_SOCKET_PASSWORD` is a secret, not a locator. Hooks must never copy, hash,
persist, or report it. `CMUX_SOCKET_PATH` may be used only as a bounded local
transport selector and must not cross the main-process boundary as renderer data.

## Capability admission

Exact focus is off by default. App foregrounding through the fixed macOS target
`/usr/bin/open -a cmux` remains the available fallback.

Every exact-focus attempt additionally requires a fresh, one-use
`dev.wrkpad.cmux-focus-authorization/v1` receipt created by a future explicit
human confirmation surface. The receipt is provider- and HMAC-session-bound,
expires after 30 seconds, and is consumed before any socket probe so it cannot be
replayed after either success or failure. The current app has no issuer for this
receipt and passes no authorization to the adapter.

A human may explicitly enable cmux socket-password control in cmux and separately
authorize Agent Board to use that capability. Agent Board must not read cmux
settings to discover a password, change the socket-control mode, place a password
on argv, inherit it from an arbitrary shell, or store it in repository files or
ordinary application preferences. A future implementation may retrieve a
user-provisioned secret from the macOS Keychain and pass it only as
`CMUX_SOCKET_PASSWORD` in the fixed CLI child's environment, with redacted errors
and output.

Every process launch must use the exact bundle CLI path above, an argv array, no
shell, a bounded environment, bounded output, and a short timeout. On timeout or
oversized output, Agent Board sends `SIGTERM`, escalates to `SIGKILL` after a
bounded grace period, and does not resolve the attempt until the child `close`
event confirms process and stdio cleanup. Admission is a fresh sequence, not a
cached “cmux connected” flag:

1. Run `--version` without a socket and parse a bounded version/build response.
2. Run socket-free `--help` probes to confirm the required command surface for
   that version.
3. With the optional human-provisioned credential, run `--json capabilities` and
   require a valid `cmux-socket` JSON response advertising the needed identity
   and focus operations plus one bounded absolute socket path. Exact focus
   requires the reported access mode to be exactly `password`; `cmuxOnly`,
   `automation`, `allowAll`, `off`, missing, and unknown modes all fail closed.
4. Pin that admitted socket path for the remainder of the attempt. Run `--socket
   <admitted-path> --json --id-format uuids identify --workspace <workspace>
   --surface <surface>` and require the echoed socket path, bundle identifier,
   fixed app/binary/CLI paths, and both locators to match the stored association.
   Capture the same-user Unix socket's device and inode before this probe and
   require that fingerprint to remain unchanged after identify, app foreground,
   workspace selection, and surface focus. A pathname alone is not server-instance
   identity because a different listener can replace it between subprocesses.
5. Only within that same bounded operation, and still pinned to the admitted
   socket path, run `select-workspace --workspace <workspace>` followed by
   `focus-panel --workspace <workspace> --panel <surface>`.

A locator is fresh only when its token-keyed HMAC equals the independently
expected binding for the selected live Claude session, it is the latest
association for that session, its capture time is no more than five minutes old,
and step 4 succeeds immediately before focus. A CLI success proves only
that cmux accepted the request. It does not prove that a human saw the expected
pane or that Claude Code accepted any input.

The current production call supplies neither authorization nor a locator. It
therefore takes the `exact_focus_not_authorized` fallback without making a socket
request and foregrounds cmux through the fixed application target. The complete
negotiation and focus sequence is covered with synthetic injected runner results;
that source test is not live cmux acceptance and does not bypass the observed
external-process denial.

Any missing locator, unsupported version, absent capability, authentication
denial, timeout, malformed or oversized JSON, server-identity change, locator
mismatch, or focus failure invalidates exact focus for that attempt. The adapter
then opens cmux as an application and returns a bounded reason code; it never
guesses by title, index, working directory, terminal contents, or active window.

## Fixed allowlist and prohibited authority

The adapter allowlist is limited to version/help probes, `capabilities`,
`identify`, `select-workspace`, and `focus-panel`. Renderer input may select a
known global Agent slot; it may never supply a provider, executable, socket path,
password, command name, locator, or arbitrary argument.

The adapter must never invoke cmux `send`, `send-key`, `send-panel`,
`send-key-panel`, `read-screen`, `capture-pane`, `pipe-pane`, `paste-buffer`,
`respawn-pane`, browser input/evaluation commands, or any equivalent terminal
read/write alias. It must not synthesize keyboard events, paste a clipboard,
submit a prompt, press Enter, approve a provider request, mark a notification
read, or scrape terminal/window content. These prohibitions apply even after the
operator enables socket-password focus.

## Acceptance matrix

| Scenario | Exact focus | Required outcome |
| --- | --- | --- |
| Claude hook outside cmux | No | Record no locator; preserve ordinary HASP state |
| Valid hook locators, no human authorization | No | Foreground cmux and report `exact_focus_not_authorized` |
| External CLI access denied | No | Preserve denial as a bounded capability reason; do not retry with another authority path |
| Authorized probe, missing required password-mode capability | No | Foreground cmux and report `capabilities_incomplete` or `access_mode_not_authorized` |
| Password capability enabled, locator validation fails | No | Invalidate the association and foreground cmux |
| Password capability enabled, fresh identity and locators match | Eligible | Select workspace, focus surface, and report only CLI acceptance |
| Any request for terminal content or input | Forbidden | Fail closed without starting cmux CLI |

Tests for an implementation must cover the fixed path, version and capability
parsing, absence and invalidity of both locators, provider/session binding,
cross-session replay, server-identity change, outside-process denial, missing and
redacted password, timeouts, oversized output, invalid JSON, focus command order,
fallback foregrounding, renderer privacy, and rejection of every prohibited verb.

[cli-contract]: https://github.com/manaflow-ai/cmux/blob/main/docs/cli-contract.md
[command-reference]: https://github.com/manaflow-ai/cmux/blob/main/skills/cmux-workspace/references/commands.md
