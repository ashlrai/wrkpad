# Local commissioning architecture

Status: design and read-only implementation contract

## Purpose

Agent Board must make a Creator Micro 2 useful without asking an operator to
interpret USB identifiers, profile caches, macOS permissions, application
ownership, and physical acceptance as one ambiguous “connected” state.

The commissioner is a local, deterministic control plane that turns those
signals into an ordered recovery session. It never infers working hardware from
USB, cache, or shortcut registration. The current shortcut receiver cannot
cryptographically distinguish the Creator Micro 2 from another keyboard.

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
6. `manual_action_required`
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

A plan digest binds the current sanitized snapshot, route, baseline digest,
candidate digest, Input-cache digest, intended outcome, and expiry. The current
implementation has no confirmation or device-write API: preparing a plan only
records a short-lived human-only handoff. A future device-specific fingerprint
or executable-content identity must be added before any deterministic writer
could be considered.

Records are written atomically with mode `0600`. Raw prompts, repository paths,
window titles, key contents, device serials, and credentials are excluded.

## Authority model

There are four distinct authority classes:

1. `observe`: enumerate and inspect bounded local evidence;
2. `plan`: validate artifacts and calculate an exact intended change;
3. `confirm`: record operator intent for one expiring plan;
4. `mutate`: change application or device state.

This repository currently implements `observe` and `plan` only. `confirm` and
`mutate` remain unavailable under the repository safety contract. The UI must
say so plainly and lead the operator through the supported Work Louder Input
action.

If a future deterministic writer is approved, it must additionally enforce:

- exact product allowlisting;
- a global single-writer lock;
- proof that Work Louder Input and other owners are stopped;
- a byte-preserving live backup before mutation;
- minimal managed-file scope;
- readback and semantic verification;
- one bounded rollback attempt; and
- an operator-attested acceptance receipt after the write.

Reset, format, profile deletion, firmware flashing, and arbitrary HID/file
commands remain outside that authority.

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
5. Review the short-lived human-only plan.
6. Guide the supported human import/activation action.
7. Re-inspect and arm Flight Check.
8. Ask for one highlighted physical gesture at a time.
9. Show provider-specific acceptance and a saved Flight receipt.

Every failure screen contains a safe retry and a concise evidence disclosure.
No retry performs a mutation.
