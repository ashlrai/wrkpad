const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMMISSIONING_PLAN_SCHEMA,
  createCommissioningPlan,
  evaluateCommissioningPlan,
  sanitizeCommissioningPlan,
} = require('./commissioning-plan.cjs')
const { createCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

const CANDIDATE_SHA = 'a'.repeat(64)

function snapshot(overrides = {}) {
  return createCommissioningSnapshot({
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
    baseline: { status: 'captured', sha256: 'b'.repeat(64) },
    physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
    ...overrides,
  }, '2026-09-04T20:00:00.000Z')
}

test('builds a deterministic content-bound external-agent visible-UI plan', () => {
  const first = createCommissioningPlan(snapshot(), { createdAt: '2026-09-04T20:01:00.000Z' })
  const second = createCommissioningPlan(snapshot(), { createdAt: '2026-09-04T20:01:00.000Z' })
  assert.deepEqual(first, second)
  assert.equal(first.schema, COMMISSIONING_PLAN_SCHEMA)
  assert.equal(first.outcome, 'ready')
  assert.equal(first.authority, 'external_agent_visible_ui')
  assert.equal(first.writesAuthorized, false)
  assert.equal(first.inputCacheSha256, CANDIDATE_SHA)
  assert.deepEqual(sanitizeCommissioningPlan(first), first)
})

test('evaluates current, expired, future, and state-drifted plans', () => {
  const initial = snapshot()
  const plan = createCommissioningPlan(initial, { createdAt: '2026-09-04T20:01:00.000Z' })
  assert.deepEqual(evaluateCommissioningPlan(plan, initial, '2026-09-04T20:02:00.000Z'), {
    status: 'current',
    reason: 'plan_matches_snapshot',
  })
  assert.equal(evaluateCommissioningPlan(plan, initial, '2026-09-04T20:31:00.000Z').status, 'expired')
  assert.equal(evaluateCommissioningPlan(plan, initial, '2026-09-04T19:59:00.000Z').reason, 'plan_timestamp_future')
  const changed = snapshot({ receiver: { status: 'absent', inputMonitoring: 'granted' } })
  assert.equal(evaluateCommissioningPlan(plan, changed, '2026-09-04T20:02:00.000Z').status, 'drifted')
})

test('binds each outcome and never promotes cache equality into already configured', () => {
  assert.equal(createCommissioningPlan(snapshot(), { createdAt: '2026-09-04T20:01:00.000Z' }).outcome, 'ready')
  assert.equal(createCommissioningPlan(snapshot({
    baseline: { status: 'missing', sha256: null },
  }), { createdAt: '2026-09-04T20:01:00.000Z' }).outcome, 'manual_export_required')
  assert.equal(createCommissioningPlan(snapshot({
    receiver: { status: 'absent', inputMonitoring: 'unknown' },
  }), { createdAt: '2026-09-04T20:01:00.000Z' }).outcome, 'blocked')
  assert.equal(createCommissioningPlan(snapshot({
    physicalAcceptance: {
      status: 'accepted',
      candidateSha256: CANDIDATE_SHA,
      acceptedAt: '2026-09-04T19:59:00.000Z',
    },
  }), { createdAt: '2026-09-04T20:01:00.000Z' }).outcome, 'already_configured')
})

test('rejects authority escalation, identifier tampering, extra fields, and invalid time bounds', () => {
  const plan = createCommissioningPlan(snapshot(), { createdAt: '2026-09-04T20:01:00.000Z' })
  assert.equal(sanitizeCommissioningPlan({ ...plan, writesAuthorized: true }), null)
  assert.equal(sanitizeCommissioningPlan({ ...plan, authority: 'agent' }), null)
  assert.equal(sanitizeCommissioningPlan({ ...plan, id: 'c'.repeat(64) }), null)
  assert.equal(sanitizeCommissioningPlan({ ...plan, devicePath: '/private' }), null)
  assert.throws(() => createCommissioningPlan(snapshot(), {
    createdAt: '2026-09-04T19:59:00.000Z',
  }), /predates/)
  assert.throws(() => createCommissioningPlan(snapshot(), {
    createdAt: '2026-09-04T20:01:00.000Z',
    ttlMs: 1,
  }), /time bounds/)
})
