# Architecture

## Product boundary

`wrkpad` observes agent lifecycle events, reduces them to six stable status slots, renders a terminal view, and plans desired lighting. It does not control agent approvals, execute arbitrary commands, modify keymaps, or infer that software state reached physical LEDs.

```text
Claude/Codex hook JSON
        │ sanitize, bound, fail open
        ▼
wrkpad hook ── bearer token ──> HASP on 127.0.0.1:43187
                                      │
                           idempotent state reducer
                                      │
                              six sticky slots
                              │             │
                              ▼             ▼
                         CLI / TUI     lighting planner
                                            │
                                    occupancy policy gate
                                            │
                                   private HID adapter
                                   disabled in v0.1
```

## Module ownership

| Module | Owns | Must not own |
| --- | --- | --- |
| `model` | Versioned events, session status, snapshots | Vendor hook JSON or HID bytes |
| `engine` | Idempotency, priority, sticky assignment, overflow | Network, terminal, process inspection |
| `hooks` | Provider-shape normalization and redaction | Approval decisions or transcript reads |
| `server` | Loopback authentication, Host/Origin policy, persistence | HID or shell execution |
| `protocol` | Report framing, bounded reassembly, correlation helpers | Device opening or unreviewed RPC methods |
| `device` | Read-only HID enumeration and identity evidence | Write enablement from VID/PID |
| `doctor` | Observable prerequisites and blockers | Permission changes or process termination |
| `occupancy` | Legal state transitions and evidence requirements | Pretending process absence proves exclusivity |
| `lighting` | Complete desired semantic frames | Claiming hardware application |
| `tui` | Accessible terminal rendering | State authority |

## Durable invariants

1. `observe` is the persisted default.
2. HASP binds only to loopback and requires a mode-`0600` bearer token for session data.
3. Hook input is untrusted and privacy-sensitive. Provider content is discarded before ingestion.
4. Existing session bindings never move because of a routine event.
5. Protected states—error, needs input, working, and unread—are not evicted to make a seventh session look successful.
6. Lower-priority events do not silently clear an error.
7. The lighting frame always says whether a transport applied it; v0.1 returns false.
8. Current-generation and legacy QMK paths are disjoint.
9. A successful OS write or RPC response would still not prove visible light.
10. Public status, source completeness, release artifacts, hardware commissioning, and operator acceptance remain separate claims.

## Persistence

The server atomically writes JSON through a private temporary file and rename. Raw provider session IDs and working directories are converted to token-keyed HMAC-SHA-256 bindings before persistence. The token and state directory are user-private on Unix.

The first public release should add parent-directory `fsync`, symlink refusal, and crash-injection tests before describing persistence as crash durable across every supported filesystem.

## Extension policy

New providers implement normalization into HASP; they do not add provider semantics to the reducer. New hardware implements the private adapter behind the same occupancy and lighting planner. Remote networking, agent control, and approvals require separate protocols and threat models and are not backwards-compatible HASP additions.

