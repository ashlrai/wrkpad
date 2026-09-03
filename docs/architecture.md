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
| `hook_config` | Read-only inventory, content-bound plans, scoped merge/repair/uninstall, private backup | Provider trust or unrelated handlers |
| `service` | Opt-in per-user macOS LaunchAgent planning, fixed-argv lifecycle, authenticated health and rollback | Root daemons, shells, secrets, or provider configuration |
| `server` | Loopback authentication, Host/Origin policy, persistence | HID or shell execution |
| `protocol` | Report framing, bounded reassembly, correlation helpers | Device opening or unreviewed RPC methods |
| `device` | Read-only HID enumeration and identity evidence | Write enablement from VID/PID |
| `doctor` | Observable prerequisites and blockers | Permission changes or process termination |
| `occupancy` | Legal state transitions and evidence requirements | Pretending process absence proves exclusivity |
| `lighting` | Complete desired semantic frames | Claiming hardware application |
| `tui` | Accessible terminal rendering | State authority |

Operator recovery follows `CLI forget → authenticated HASP DELETE → reducer → atomic persistence`. It is a local display-state operation, never an agent-control operation.

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

The server bounds persisted JSON to 4 MiB, refuses symlinked state files, atomically writes through a private temporary file and rename, synchronizes the file and parent directory on Unix, and rolls live state back when persistence fails. Raw provider session IDs and working directories are converted to token-keyed HMAC-SHA-256 bindings before persistence. The token and state directory are user-private on Unix.

Crash-injection and cross-platform filesystem acceptance are still required before describing persistence as crash durable across every supported filesystem.

## Unified slot and intent routing

The implemented HASP reducer is one mixed, provider-neutral queue. Codex and
Claude Code events compete for the same six sticky slots under the same state
priority and overflow rules. Provider identity is part of the token-keyed HMAC
input before the reducer sees a session binding, so equal provider-local session
IDs do not collide. The snapshot keeps the provider on each occupied slot; Agent
Board uses that field to choose only a fixed application target: `codex` opens
ChatGPT and `claude` opens cmux.

This produces one provider-neutral intent vocabulary:

| Intent | Resolution rule | Current evidence boundary |
| --- | --- | --- |
| `focus_slot(slot)` | Read the provider from that occupied global slot, then open its fixed provider application | Implemented; application foregrounding only |
| `focus_attention(all)` | Select `error > needs_input > working > unread > idle`, then the lowest global slot number | Implemented as the default Attention behavior |
| `focus_attention(codex\|claude)` | Apply the same priority rule to slots from one provider, without moving or renumbering them | Proposed; no preference or selector exists yet |

`all` must remain the default. A future Codex/Claude scope toggle is a local
presentation and Attention filter over the same snapshot, not a second reducer,
provider-specific slot bank, hook change, or hardware remap. Hidden slots retain
their global AG00-AG05 identities and continue receiving state updates. Direct
slot focus must still resolve the provider from the fresh main-process snapshot,
never from a renderer-supplied provider or the selected lens.

The smallest implementation gap is therefore one bounded `all | codex | claude`
view preference and one pure candidate selector shared by the runway and
Attention action. Tests must pin mixed ordering, unchanged global slot numbers,
empty filtered results, deterministic ties, invalid-scope fallback to `all`, and
fixed provider targets. This change must not claim exact Codex-task or cmux-pane
focus and must not paste, submit, approve, or send terminal input.

Codex Native is an explicit exception at the physical-control layer. ChatGPT owns
the Creator Micro keys on that route, so Agent Board can mirror observed slots on
screen but cannot promise the same mixed-provider physical key semantics. Daily
cross-provider control requires the Ashlr Layer route; native firmware
qualification remains a separate passive route and evidence chain.

The [cmux provider adapter](../protocol/cmux-provider-adapter.md) implements a
fixed-path, capability-negotiated exact-focus substrate without terminal
read/write authority. Locator capture and socket-password enrollment remain
absent, so current Claude slot focus deliberately takes the cmux application
foreground fallback.

## Extension policy

New providers implement normalization into HASP; they do not add provider semantics to the reducer. New hardware implements the private adapter behind the same occupancy and lighting planner. Remote networking, agent control, and approvals require separate protocols and threat models and are not backwards-compatible HASP additions.
