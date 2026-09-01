# Provider compatibility contracts

Agent Board reads two local JSON commands through the bounded adapter in
`electron/mission-control.cjs`. Compatibility means that a response can be
validated and reduced to the small renderer snapshot. It does not prove that a
provider invoked hooks, that a Fleet has remote authority, or that the physical
board displayed anything.

## Supported contracts

| Producer command | Agent Board contract | Required compatibility marker |
| --- | --- | --- |
| `wrkpad status --json` | HASP state v1 | Exact `schema: dev.wrkpad.hasp.state/v1` and a `slots` array |
| `ashlr fleet status --json` | Agent Board Fleet adapter v1 | The bounded timestamp, daemon, queue, proposal, goal, and mission-brief fields listed below |

Ashlr Hub does not currently put a version marker on the root Fleet status
object. “Fleet adapter v1” therefore names Agent Board's local projection, not
an upstream Ashlr schema or authority level.

The Fleet adapter requires:

- `generatedAt`;
- `daemon.running` and `daemon.activity.phase`;
- non-negative safe integers for `queue.backlogItems`,
  `queue.eligibleBacklogItems`, `queue.repairControlBlockedItems`,
  `proposals.pending`, and `goalFocus.activeGoalCount`;
- `missionBrief.operatingMode` and `missionBrief.directive`.

Invalid responses stay `invalid`; execution failures, timeouts, nonzero exits,
oversized output, and malformed JSON stay `unavailable`. Neither state is
converted to empty authoritative counts.

## Fixtures and privacy

`fixtures/provider-contracts/` contains one accepted and one intentionally
incompatible response for each adapter. The fixtures use fixed synthetic data.
They contain no raw provider session IDs, user paths, prompts, transcripts,
command arguments, credentials, or trust decisions. The wrkpad fixture uses
visibly synthetic `hmac-sha256:` bindings because an opaque binding is part of
the HASP state wire shape; Agent Board tests prove those bindings do not enter
renderer summaries.

Validation returns stable, content-free reason codes such as
`unsupported_schema` and `invalid_mission_directive`. Messages identify only the
contract field, never the rejected value.

## Upgrade policy

1. Add a synthetic incompatible fixture before accepting a new producer shape.
2. Add a valid fixture for the new contract and update the validator and this
   table in the same change.
3. Keep the prior fixture green while the prior contract remains supported.
4. Treat a breaking HASP schema or Fleet projection change as a new adapter
   version. Do not silently reinterpret it as empty or healthy data.
5. Remove an old contract only in a documented breaking release with a clear
   operator upgrade path.

Run `npm test`, `npm run lint`, and `npm run build` from `app/` after changing a
fixture or validator. The public-demo validation must also remain green because
its fixed-data bridge exercises the same renderer-facing snapshot types.
