const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMMISSIONING_SNAPSHOT_SCHEMA,
  commissioningSnapshotSha256,
  createCommissioningSnapshot,
  evaluateCommissioningOutcome,
  sanitizeCommissioningSnapshot,
} = require('./commissioning-snapshot.cjs')

const CANDIDATE_SHA = 'a'.repeat(64)
const BASELINE_SHA = 'b'.repeat(64)

function evidence(overrides = {}) {
  return {
    device: { status: 'exact', vidPid: '303A:8298' },
    input: {
      installation: 'trusted',
      version: '0.18.4',
      running: 'quit',
      cacheStatus: 'candidate',
      inputCacheSha256: CANDIDATE_SHA,
    },
    receiver: { status: 'single_trusted', inputMonitoring: 'granted' },
    candidate: { status: 'verified', sha256: CANDIDATE_SHA },
    baseline: { status: 'captured', sha256: BASELINE_SHA },
    physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
    ...overrides,
  }
}

test('creates a strict privacy-projected Ashlr Layer snapshot', () => {
  const snapshot = createCommissioningSnapshot(evidence(), '2026-09-04T20:00:00.000Z')
  assert.equal(snapshot.schema, COMMISSIONING_SNAPSHOT_SCHEMA)
  assert.equal(snapshot.route, 'ashlr_layer')
  assert.equal(snapshot.input.inputCacheSha256, CANDIDATE_SHA)
  assert.deepEqual(sanitizeCommissioningSnapshot(snapshot), snapshot)
  assert.doesNotMatch(JSON.stringify(snapshot), /Users|serial|prompt|transcript|workspace|artifactPath/)
})

test('derives every plan outcome without treating the Input cache as device-sync proof', () => {
  const ready = createCommissioningSnapshot(evidence(), '2026-09-04T20:00:00.000Z')
  assert.deepEqual(evaluateCommissioningOutcome(ready), {
    outcome: 'ready',
    reason: 'candidate_ready_for_human_input',
    nextAction: 'review_manual_input_steps',
  })

  const manual = createCommissioningSnapshot(evidence({
    baseline: { status: 'missing', sha256: null },
  }), '2026-09-04T20:00:00.000Z')
  assert.equal(evaluateCommissioningOutcome(manual).outcome, 'manual_export_required')

  const blocked = createCommissioningSnapshot(evidence({
    receiver: { status: 'multiple', inputMonitoring: 'granted' },
  }), '2026-09-04T20:00:00.000Z')
  assert.deepEqual(evaluateCommissioningOutcome(blocked), {
    outcome: 'blocked',
    reason: 'receiver_multiple',
    nextAction: 'resolve_blocker',
  })

  const accepted = createCommissioningSnapshot(evidence({
    physicalAcceptance: {
      status: 'accepted',
      candidateSha256: CANDIDATE_SHA,
      acceptedAt: '2026-09-04T19:59:00.000Z',
    },
  }), '2026-09-04T20:00:00.000Z')
  assert.equal(evaluateCommissioningOutcome(accepted).outcome, 'already_configured')

  const cacheChangedAfterAcceptance = createCommissioningSnapshot(evidence({
    input: {
      ...evidence().input,
      cacheStatus: 'different',
      inputCacheSha256: 'c'.repeat(64),
    },
    physicalAcceptance: {
      status: 'accepted',
      candidateSha256: CANDIDATE_SHA,
      acceptedAt: '2026-09-04T19:59:00.000Z',
    },
  }), '2026-09-04T20:00:00.000Z')
  assert.equal(evaluateCommissioningOutcome(cacheChangedAfterAcceptance).outcome, 'ready')
})

test('semantic snapshot hashes ignore collection time but bind all commissioning evidence', () => {
  const first = createCommissioningSnapshot(evidence(), '2026-09-04T20:00:00.000Z')
  const second = createCommissioningSnapshot(evidence(), '2026-09-04T20:00:01.000Z')
  const changed = createCommissioningSnapshot(evidence({
    input: { ...evidence().input, running: 'running' },
  }), '2026-09-04T20:00:01.000Z')
  assert.equal(commissioningSnapshotSha256(first), commissioningSnapshotSha256(second))
  assert.notEqual(commissioningSnapshotSha256(first), commissioningSnapshotSha256(changed))
})

test('rejects malformed, future acceptance, cache inconsistency, extra privacy fields, and other routes', () => {
  const snapshot = createCommissioningSnapshot(evidence(), '2026-09-04T20:00:00.000Z')
  assert.equal(sanitizeCommissioningSnapshot({ ...snapshot, serial: 'private' }), null)
  assert.equal(sanitizeCommissioningSnapshot({ ...snapshot, route: 'codex_native' }), null)
  assert.equal(sanitizeCommissioningSnapshot({
    ...snapshot,
    input: { ...snapshot.input, inputCacheSha256: 'c'.repeat(64) },
  }), null)
  assert.equal(sanitizeCommissioningSnapshot({
    ...snapshot,
    physicalAcceptance: {
      status: 'accepted',
      candidateSha256: CANDIDATE_SHA,
      acceptedAt: '2026-09-04T20:00:01.000Z',
    },
  }), null)
  assert.throws(() => createCommissioningSnapshot({ ...evidence(), workspace: '/private' }), /invalid or privacy-unbounded/)
})
