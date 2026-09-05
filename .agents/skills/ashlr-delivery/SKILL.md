---
name: ashlr-delivery
description: Deliver ambitious repository work in Amplify, Verify, Polish, or Advance mode with state-first investigation, evidence-backed completion, parallel review, and explicit authority gates. Use when invoked as $ashlr-delivery <mode> in Codex or Claude Code.
---

# Ashlr Delivery

Invoke as `$ashlr-delivery <mode>`, where mode is `Amplify`, `Verify`, `Polish`,
or `Advance`. If the mode is missing or ambiguous, ask which outcome the user
wants before making material changes.

## Select the mode

- **Amplify:** make the requested product meaningfully more useful or ambitious.
  Find the highest-leverage user outcome, then deliver a coherent vertical slice.
- **Verify:** test stated behavior and claims independently. Default to read-only;
  repair only when the request also authorizes changes.
- **Polish:** harden an existing implementation for maintainability, UX,
  accessibility, privacy, documentation, packaging, and release readiness.
- **Advance:** inspect the roadmap and current evidence, choose the safest
  high-value next slice, and implement it end to end.

The mode changes emphasis, not authority. Preserve the user's stated scope.
Every mode is provider-neutral and applies equally to Codex, Claude Code/cmux,
and other supported agent surfaces; never project one provider's hooks, focus,
or approval semantics onto another.

## Work from evidence

1. Read `AGENTS.md` and any closer repository instructions. In Claude Code,
   also honor `CLAUDE.md`.
2. Before planning, inspect `git status --short --branch`, recent commits, the
   affected implementation, tests, and public claims. If Entire is already
   installed, inspect its status; never install, enable, repair, or restore it
   without a request.
3. Run the repository's read-only preflight when hardware, providers, hooks,
   setup, or release readiness is involved. Keep declared and requested routes
   distinct.
4. State the intended user outcome, in-scope surfaces, important unknowns, and
   observable acceptance evidence. Ask only questions whose answers would
   materially change the solution or authorization.
5. For changes spanning three or more files, delegate at least one bounded,
   independent exploration or review stream when agents are available. Avoid
   overlapping editors; preserve other agents' and the user's changes. If
   delegation is unavailable, say so and continue locally.
6. Reuse current schemas, helpers, visual language, and trust boundaries. Build
   the smallest complete slice that achieves the outcome; do not substitute a
   mock, plan, or generic shell for the requested end-to-end behavior.
7. Test success, denial, malformed or missing evidence, privacy, recovery, and
   accessibility in proportion to risk. Run the repository's documented
   format, lint, test, build, documentation, package, and security checks that
   apply. Do not silently install a missing verifier.
8. Review the final diff independently. Remove stale claims and report any gate
   that remains manual, skipped, failed, or outside scope.

## Acceptance evidence

Define acceptance before implementation and report each layer separately:

- source behavior implemented;
- focused and full validation results;
- package or installer built and inspected, or not performed;
- local configuration applied, or not performed;
- provider invocation observed, or not performed;
- physical and operator acceptance recorded, or not performed;
- public release or deployment completed, or not performed.

Evidence proves only its own layer. A green test does not prove packaging,
installation, provider behavior, physical behavior, approval, or release. Use
synthetic fixtures and bounded receipts; never expose private prompts,
transcripts, task names, raw provider payloads, credentials, full local paths,
device serials, or unredacted logs.

## Authority gates

Normal source inspection, requested source edits, local tests, builds, linting,
and reversible offline artifacts are allowed. Never infer authority—even from
“continue,” “finish,” “do everything,” or a mode name—for:

- push, merge, deploy, publish, release, or external communication;
- deletion or destructive cleanup;
- purchases, paid services, credentials, or production/provider activation;
- firmware, bootloader, raw HID, direct keymap/device-filesystem writes, reset,
  deletion, private Input IPC, or Input cache/database edits;
- macOS TCC, Input Monitoring, Accessibility, or other permission changes;
- killing applications or competing device owners;
- provider approval, hook trust, inbox decisions, or consequential fleet action;
- prompt submission, terminal input, or claims of exact task/thread/pane focus.

Stop immediately before such an action and obtain explicit authorization for
the exact target and consequence. The one narrow exception is enrolled Creator
Micro 2 commissioning: after one-time local enrollment, an agent may gracefully
quit/relaunch Work Louder Input and drive its visible import/activation UI only
under a fresh, one-use plan bound to the exact app identity, device class,
route, before-state backup, candidate digest, ordered actions, readback, and
rollback artifact. Any drift or unexpected dialog fails closed. Enrollment
never authorizes TCC changes, direct cache/HID writes, reset, deletion,
firmware, or a future profile. Preserve confirmation, hold, rollback, and real
physical-operation gates already present in the project.

## Finish with a truthful handoff

Lead with the user-visible outcome, then report:

```text
Source: <SHA, branch, and dirty state>
Implemented: <observable behavior>
Verified: <commands and exact results>
Packaged/installed: <state or not performed>
Provider/physical/operator evidence: <state or not performed>
Released: <exact artifact/deployment or not performed>
Remaining gates: <manual approval, permission, hardware, provider, or review>
Rollback: <procedure or explicitly unavailable>
```

Do not claim completion while an acceptance criterion within the authorized
scope remains untested or known-broken. Do not present an unauthorized external
gate as completed work.
