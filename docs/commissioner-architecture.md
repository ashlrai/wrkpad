# Local commissioning architecture

Status: design and read-only implementation contract

## Purpose

Agent Board must make a Creator Micro 2 useful without asking an operator to
interpret USB identifiers, profile caches, macOS permissions, application
ownership, and physical acceptance as one ambiguous “connected” state.

The commissioner is a local, deterministic control plane that turns those
signals into an ordered recovery session. It never claims a working key until a
fresh physical event reaches the intended receiver.

## Evidence ladder

| Level | Proves | Does not prove |
| --- | --- | --- |
| USB identity | An exact supported device is enumerated | Active profile or key delivery |
| Candidate validation | The intended profile is structurally exact | Import, activation, or sync |
| Installation trust | The inspected application identity matches policy | Device ownership or sync |
| Receiver readiness | The expected shortcut receiver is live | The board emits that shortcut |
| Shadow receipt | A matching physical report was observed | The mapped application action ran |
| Action receipt | The intended application handled the event | Every control or provider works |
| Physical acceptance | The required fresh gestures passed | Future sessions cannot drift |

User-facing copy must identify the highest proven level and the next missing
receipt. It must not collapse the ladder into a green dot.

## State machine

The read-only commissioner recognizes these monotonic states:

1. `disconnected`
2. `device_exact`
3. `route_selected`
4. `install_trusted`
5. `baseline_captured`
6. `candidate_verified`
7. `awaiting_confirmation`
8. `human_action_required`
9. `sync_unproven`
10. `flight_armed`
11. `physical_accepted`
12. `commissioned`

`blocked` is used when an invariant fails and the next action cannot proceed.
The reducer derives state from typed evidence. Renderers and LLM output cannot
promote it.

## Session and plan records

A commissioning session is private local state containing:

- a random session identifier;
- exact product and vendor identifiers;
- a salted device fingerprint, never the raw serial;
- requested route;
- baseline and candidate SHA-256 digests;
- inspected executable identity and trust result;
- owner/receiver observations;
- timestamps, expiry, and state transitions; and
- sanitized physical/action receipts.

A plan digest binds the device fingerprint, route, baseline digest, candidate
digest, executable identity, requested operations, and expiry. Confirmation is
one-use and only authorizes that exact plan. In the current implementation,
confirmation advances to `human_action_required`; it does not grant a device
write.

Records are written atomically with mode `0600`. Raw prompts, repository paths,
window titles, key contents, device serials, and credentials are excluded.

## Authority model

There are four distinct authority classes:

1. `observe`: enumerate and inspect bounded local evidence;
2. `plan`: validate artifacts and calculate an exact intended change;
3. `confirm`: record operator intent for one expiring plan;
4. `mutate`: change application or device state.

This repository currently implements the first three only. `mutate` remains
unavailable under the repository safety contract. The UI must say so plainly
and lead the operator through the supported Work Louder Input action.

If a future deterministic writer is approved, it must additionally enforce:

- exact product allowlisting;
- a global single-writer lock;
- proof that Work Louder Input and other owners are stopped;
- a byte-preserving live backup before mutation;
- minimal managed-file scope;
- readback and semantic verification;
- one bounded rollback attempt; and
- a physical acceptance receipt after the write.

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
5. Bind one confirmation to the plan.
6. Guide the supported human import/activation action.
7. Re-inspect and arm Flight Check.
8. Ask for one highlighted physical gesture at a time.
9. Show provider-specific acceptance and a durable receipt.

Every failure screen contains a safe retry and a concise evidence disclosure.
No retry performs a mutation.
