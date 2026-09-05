# Local commissioning architecture

Status: read-only implementation plus agent-operated commissioning authority
contract

## Purpose

Agent Board must make a Creator Micro 2 useful without asking an operator to
interpret USB identifiers, profile caches, macOS permissions, application
ownership, and physical acceptance as one ambiguous “connected” state.

The commissioner is a local, deterministic control plane that turns those
signals into an ordered recovery session. It never infers working hardware from
USB, cache, shortcut registration, or a successful vendor UI message. The
current shortcut receiver cannot cryptographically distinguish the Creator
Micro 2 from another keyboard.

The current source implements the evidence and planning path. The supported
near-term mutation design lets an enrolled local agent operate the visible Work
Louder Input UI for one exact import-and-activate run. It does not grant the
agent a general device writer. Until an executor implements every invariant in
this document, the plan must remain non-executable and the UI must describe the
remaining handoff accurately.

## Evidence ladder

| Level | Proves | Does not prove |
| --- | --- | --- |
| USB identity | An exact supported device is enumerated | Active profile or key delivery |
| Candidate validation | The intended profile is structurally exact | Import, activation, or sync |
| Installation trust | The inspected application identity matches policy | Device ownership or sync |
| Receiver readiness | The expected shortcut receiver is live | The board emits that shortcut |
| Shadow receipt | A matching physical report was observed | The mapped application action ran |
| Action receipt | The intended application handled the event | Every control or provider works |
| Active operator check | The operator-attested shortcut sequence reached this active receiver | The OS identified the physical keyboard source or a future session is accepted |

User-facing copy must identify the highest proven level and the next missing
receipt. It must not collapse the ladder into a green dot.

## State machine

The current read-only commissioner derives these states from fresh evidence:

1. `disconnected`
2. `device_exact`
3. `environment_verified`
4. `baseline_captured`
5. `candidate_verified`
6. `authorization_required`
7. `physical_check_ready`
8. `commissioned` (active-run acceptance only)

`blocked` is used when an invariant fails and the next action cannot proceed.
The reducer derives state from typed evidence. Renderers and LLM output cannot
promote it.

## Session and plan records

A commissioning journal is private local state containing:

- exact product and vendor identifiers;
- requested route;
- baseline and candidate SHA-256 digests;
- bounded installation trust and receiver observations;
- timestamps, expiry, and state transitions; and
- sanitized operator-check/action receipts.

A plan digest binds the current sanitized snapshot, route, protected
before-state digest, candidate digest, Input application identity, device
identity class, intended visible UI transitions, recovery action, and expiry.
Preparing a plan does not authorize it. The current implementation has no
commissioning executor, so its plan remains non-executable. An agent-operated
executor must refuse to begin until the enrollment and per-run authority below
match the fresh plan byte for byte.

Records are written atomically with mode `0600`. Raw prompts, repository paths,
window titles, key contents, device serials, and credentials are excluded.

## Authority model

There are four distinct authority classes:

1. `observe`: enumerate and inspect bounded local evidence;
2. `plan`: validate artifacts and calculate an exact intended change;
3. `confirm`: record operator intent for one expiring plan;
4. `mutate`: change application or device state.

This repository currently implements `observe` and `plan`. `confirm` and
`mutate` describe the bounded agent-operated path and remain unavailable until
an executor implements the complete contract. The UI must say which state is
implemented instead of presenting an enrollment or plan as a completed write.

### One-time enrollment

Enrollment is an explicit local choice by the user to let an agent operate one
verified Work Louder Input installation through its visible UI. It records:

- the allowed Input bundle identity, version, publisher policy, and executable
  content identity;
- the allowed Creator Micro 2 identity class and board route;
- the allowed operation set: protect before-state, import one exact candidate,
  make that candidate current, gracefully relaunch Input for readback, and
  perform one bounded rollback when verification fails;
- a private backup location, retention policy, and revocation control; and
- an expiry or explicit re-enrollment trigger for application, device, route,
  permission, or policy changes.

Enrollment is not macOS Accessibility or Input Monitoring permission, does not
approve a particular profile, and does not authorize future candidate hashes.
The user grants operating-system permissions through macOS. An agent may
inspect their visible result but must not click through or alter TCC on the
user's behalf.

### Exact per-run authority

Each commissioning run requires a fresh, one-use authorization bound to:

- the enrollment identifier and exact Input content identity;
- the supported device identity class and requested route;
- the candidate file SHA-256 and strict semantic validation result;
- the fresh before-state and rollback-artifact SHA-256 values;
- the exact ordered UI actions, maximum write count, and terminal success text;
- the expected post-write profile, layer, and configuration checksum;
- the cold-relaunch readback procedure; and
- a nonce and short expiry.

Changing any bound byte, encountering an unexpected dialog, losing single-owner
conditions, or consuming the authorization invalidates the run. “Continue,” a
previous enrollment, and a matching filename are never substitutes for this
content-bound authority.

### Protected apply and rollback

An agent-operated run must enforce all of the following:

- exact product allowlisting;
- a global single-writer lock;
- proof that Work Louder Input and other owners are stopped;
- a verified, byte-preserving before-state export from the live vendor UI before
  mutation, stored privately without overwriting an existing file;
- rejection when that export cannot be saved, parsed, hashed, or reconciled
  with a fresh cold-relaunch readback;
- visible Input UI import and activation of only the candidate digest named in
  the plan;
- graceful Input quit and relaunch, never a kill, followed by a fresh board
  readback and exact checksum plus semantic verification;
- one bounded UI rollback to the protected artifact when apply or readback
  fails, followed by the same cold-relaunch readback; and
- a terminal failed-and-escalated result if rollback cannot be verified.

The app's “layout updated” message proves neither activation nor readback.
Input's cache or database is diagnostic evidence only and must never be copied
or relabeled as the protected backup. If the vendor export dialog cannot produce
a valid file, commissioning stops before the first write.

Reset, format, profile deletion, firmware flashing, and arbitrary HID/file
commands remain outside that authority. Direct Input cache/database mutation,
private renderer IPC, remote debugging, synthetic key events, and raw
device-filesystem writes are never fallbacks.

### Separate physical receipt

Configuration success ends at verified readback. The agent may then arm Flight
Check, suppress mapped actions, highlight each expected gesture, and record the
real events. A person must still move the real control unless a separately
qualified vendor electrical self-test or robotic fixture exists. Injected
keyboard events cannot satisfy this gate. The receipt is bound to the current
route, receiver generation, profile digest, device identity class, and time
window; a later reconnect or configuration change invalidates it.

## Process boundaries

- Electron main owns diagnostics, session state, filesystem access, and policy.
- Preload exposes a narrow validated commissioning API.
- The renderer presents evidence and requests allowed transitions; it has no
  Node, filesystem, shell, or HID authority.
- Optional language-model assistance receives a sanitized snapshot only. It can
  explain evidence but cannot create authority or execute a mutation.

## Provider parity

Codex, Claude Code, and cmux report individual capabilities:

- detected;
- focus/select support;
- event receipt support;
- hook/session support; and
- physically accepted.

The UI must not infer exact task focus in Codex or exact pane focus in cmux when
the provider adapter cannot prove it. The default Ashlr layer keeps the same
physical accelerator vocabulary across supported surfaces; adapters decide what
can be executed and evidenced.

## Recovery UX

The wizard is intentionally linear:

1. Find this board.
2. Explain the exact missing receipt.
3. Protect the current configuration.
4. Validate the intended profile.
5. Enroll the exact local UI authority once, or keep the guided handoff.
6. Authorize one content-bound apply plan.
7. Protect the live before-state, apply through visible Input UI, cold-relaunch,
   and verify readback; roll back once on failure.
8. Re-inspect and arm Flight Check.
9. Ask for one highlighted physical gesture at a time.
10. Show provider-specific acceptance and a saved Flight receipt.

Every failure screen contains a concise evidence disclosure. Read-only checks
may be retried freely. A write retry requires a new plan and authorization;
rollback is attempted at most once under the consumed plan.
