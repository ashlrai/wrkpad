# wrkpad for organizations

wrkpad is open-source software. The Rust core remains available under MIT and
Ashlr Agent Board remains available under Apache-2.0. An organizational
engagement does not replace, narrow, or revoke those grants.

## What can be evaluated now

Ashlr can scope a separate engagement for teams that need help evaluating or
operating the project in a controlled environment:

- architecture and threat-model review;
- local rollout planning and operator training;
- provider-adapter and policy design;
- acceptance plans for recognized, in-scope Creator Micro 2 variants;
- source-level security and privacy evidence packages; and
- support expectations, escalation paths, and response targets defined in a
  signed statement of work.

These are evaluation areas, not bundled entitlements or standing service-level
agreements. Availability, price, response times, environments, supported
versions, and acceptance criteria must be agreed in writing for each
engagement.

## Current product boundary

| Evidence layer | Current status |
| --- | --- |
| Source, licenses, CI, and security policy | Available in the public repository |
| Local macOS build | Source-buildable and ad-hoc sealed; no Developer ID signature or notarization |
| Local commissioner | Implemented and source-tested; read-only for device state |
| Work Louder Input profile import and device synchronization | Manual operator action |
| Provider hook configuration | Guarded plan/apply flow; provider trust and invocation require separate acceptance |
| Physical Creator Micro 2 acceptance | Per-device, per-route operator Flight Check required |
| Signed public macOS distribution | Not available |
| Hosted control plane or managed fleet service | Not offered by this repository |
| Compliance certification or government authorization | Not claimed |

Source tests, a local package, a configured hook, a visible USB identity, and a
physical acceptance receipt prove different things. See [Release and readiness](docs/release.md)
and [Security](SECURITY.md) before using the project in a controlled environment.

## Enterprise, regulated, and public-sector evaluation

Organizations can ask Ashlr to evaluate requirements such as deployment
topology, data handling, audit evidence, accessibility, support coverage,
procurement documentation, and customer-managed controls. The resulting scope
must identify the exact software revision, device route, operator authority,
data boundary, verification plan, and rollback owner.

No statement in this document claims FedRAMP, FIPS validation, SOC 2, ISO 27001,
HIPAA eligibility, export classification, government authorization, or
procurement-list status. Those claims require their own current evidence and
contractual review.

## Start an evaluation

Email [hello@ashlr.ai](mailto:hello@ashlr.ai?subject=wrkpad%20organizational%20evaluation)
with the intended environment, provider mix, hardware quantity, security or
procurement constraints, and desired acceptance outcome. Do not include
credentials, prompts, transcripts, private repository names, or unredacted
diagnostic receipts.
