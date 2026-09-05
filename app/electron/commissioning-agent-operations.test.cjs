const test = require('node:test')
const assert = require('node:assert/strict')
const {
  COMMISSIONING_AGENT_OPERATION_SCHEMA,
  createCommissioningAgentOperationExecutor,
  sanitizeCommissioningAgentOperationRequest,
} = require('./commissioning-agent-operations.cjs')
const { createCommissioningPlan } = require('./commissioning-plan.cjs')
const { createCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

const CANDIDATE_SHA = 'a'.repeat(64)
const BASELINE_SHA = 'b'.repeat(64)

function snapshot(overrides = {}) {
  return createCommissioningSnapshot({
    device: { status: 'exact', vidPid: '303A:8298' },
    input: { installation: 'trusted', version: '0.18.4', running: 'quit', cacheStatus: 'different', inputCacheSha256: 'c'.repeat(64) },
    receiver: { status: 'single_trusted', inputMonitoring: 'granted' },
    candidate: { status: 'verified', sha256: CANDIDATE_SHA },
    baseline: { status: 'captured', sha256: BASELINE_SHA },
    physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
    ...overrides,
  }, '2026-09-04T20:00:00.000Z')
}

function response(snapshotValue = snapshot(), includePlan = true) {
  const plan = includePlan ? createCommissioningPlan(snapshotValue, { createdAt: '2026-09-04T20:01:00.000Z' }) : null
  return {
    ok: true,
    code: 'observed',
    message: 'private dependency text must not cross the boundary',
    snapshot: snapshotValue,
    plan,
    journalRevision: plan ? 1 : null,
  }
}

function fixture(responseValue = response()) {
  const calls = []
  const executor = createCommissioningAgentOperationExecutor({
    inspect: async () => { calls.push('inspect'); return structuredClone(responseValue) },
    plan: async () => { calls.push('plan'); return { ...structuredClone(responseValue), code: 'plan_prepared' } },
  })
  return { calls, executor }
}

test('accepts only the four exact typed operation request shapes', () => {
  assert.deepEqual(sanitizeCommissioningAgentOperationRequest({ operation: 'inspect', planId: null }), { operation: 'inspect', planId: null })
  assert.deepEqual(sanitizeCommissioningAgentOperationRequest({ operation: 'apply', planId: 'a'.repeat(64) }), { operation: 'apply', planId: 'a'.repeat(64) })
  for (const value of [
    null,
    { operation: 'shell', planId: null },
    { operation: 'inspect', planId: 'a'.repeat(64) },
    { operation: 'apply', planId: null },
    { operation: 'apply', planId: 'a'.repeat(64), executable: '/bin/sh' },
  ]) assert.equal(sanitizeCommissioningAgentOperationRequest(value), null)
})

test('executes inspect and plan through fixed functions and projects bounded capabilities', async () => {
  const state = fixture()
  const inspected = await state.executor.execute({ operation: 'inspect', planId: null })
  const planned = await state.executor.execute({ operation: 'plan', planId: null })

  assert.deepEqual(state.calls, ['inspect', 'plan'])
  assert.equal(inspected.agentOperation.schema, COMMISSIONING_AGENT_OPERATION_SCHEMA)
  assert.equal(inspected.agentOperation.status, 'completed')
  assert.equal(inspected.agentOperation.internalExecutor, 'not_configured')
  assert.equal(inspected.agentOperation.capabilities.inspect.availability, 'available')
  assert.equal(planned.agentOperation.capabilities.plan.executor, 'electron_main')
  assert.equal(planned.message, 'Read-only commissioning plan prepared. Work Louder Input and the board were not changed.')
  assert.doesNotMatch(JSON.stringify(planned), /private dependency text/)
})

test('keeps apply and rollback external-only and performs no mutation', async () => {
  const state = fixture()
  const current = response()
  const apply = await state.executor.execute({ operation: 'apply', planId: current.plan.id })
  const rollback = await state.executor.execute({ operation: 'rollback', planId: current.plan.id })

  assert.deepEqual(state.calls, ['inspect', 'inspect'])
  for (const value of [apply, rollback]) {
    assert.equal(value.ok, false)
    assert.equal(value.code, 'external_executor_required')
    assert.equal(value.agentOperation.status, 'external_handoff_required')
    assert.equal(value.agentOperation.capabilities[value.agentOperation.requestedOperation].availability, 'external_only')
    assert.equal(value.agentOperation.capabilities[value.agentOperation.requestedOperation].executor, 'enrolled_agent_visible_ui')
  }
  assert.match(apply.message, /visible Work Louder Input UI/)
  assert.match(rollback.message, /source backup/)
})

test('blocks stale identifiers, missing plans, and malformed dependency results', async () => {
  const state = fixture()
  assert.equal((await state.executor.execute({ operation: 'apply', planId: 'f'.repeat(64) })).code, 'operation_blocked')

  const noPlan = fixture(response(snapshot(), false))
  const blocked = await noPlan.executor.execute({ operation: 'rollback', planId: 'f'.repeat(64) })
  assert.equal(blocked.code, 'operation_blocked')
  assert.equal(blocked.agentOperation.capabilities.rollback.availability, 'blocked')

  const malformed = fixture({ rawPath: '/Users/private' })
  const unavailable = await malformed.executor.execute({ operation: 'inspect', planId: null })
  assert.equal(unavailable.code, 'operation_unavailable')
  assert.doesNotMatch(JSON.stringify(unavailable), /Users|rawPath/)
})

test('reports apply as unnecessary only for current physically accepted evidence', async () => {
  const acceptedSnapshot = snapshot({
    input: { installation: 'trusted', version: '0.18.4', running: 'quit', cacheStatus: 'candidate', inputCacheSha256: 'c'.repeat(64) },
    physicalAcceptance: { status: 'accepted', candidateSha256: CANDIDATE_SHA, acceptedAt: '2026-09-04T20:00:00.000Z' },
  })
  const current = response(acceptedSnapshot)
  const state = fixture(current)
  const result = await state.executor.execute({ operation: 'apply', planId: current.plan.id })
  assert.equal(result.code, 'operation_not_needed')
  assert.equal(result.agentOperation.status, 'not_needed')
  assert.equal(result.agentOperation.capabilities.apply.availability, 'not_needed')
})
