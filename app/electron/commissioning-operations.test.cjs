const test = require('node:test')
const assert = require('node:assert/strict')
const { isDeepStrictEqual } = require('node:util')
const { createCommissioningOperationCoordinator } = require('./commissioning-operations.cjs')
const { createCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

function snapshot(overrides = {}, observedAt = '2026-09-04T20:00:00.000Z') {
  return createCommissioningSnapshot({
    device: { status: 'exact', vidPid: '303A:8298' },
    input: {
      installation: 'trusted',
      version: '0.18.4',
      running: 'quit',
      cacheStatus: 'candidate',
      inputCacheSha256: 'a'.repeat(64),
    },
    receiver: { status: 'single_trusted', inputMonitoring: 'granted' },
    candidate: { status: 'verified', sha256: 'a'.repeat(64) },
    baseline: { status: 'captured', sha256: 'b'.repeat(64) },
    physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
    ...overrides,
  }, observedAt)
}

function fixture(overrides = {}) {
  let journal = overrides.journal ?? null
  const calls = []
  const snapshots = [...(overrides.snapshots ?? [snapshot()])]
  let collection = 0
  const coordinator = createCommissioningOperationCoordinator({
    now: overrides.now ?? (() => '2026-09-04T20:01:00.000Z'),
    collectSnapshot: async () => {
      calls.push('collect')
      if (overrides.collectSnapshot) return overrides.collectSnapshot({ collection: collection++, calls })
      const value = snapshots[Math.min(collection, snapshots.length - 1)]
      collection += 1
      return structuredClone(value)
    },
    readJournal: () => {
      calls.push('read')
      return overrides.readJournal ? overrides.readJournal({ journal, calls }) : structuredClone(journal)
    },
    writeJournal: async (value, expectedRevision) => {
      calls.push('write')
      if (overrides.writeJournal) return overrides.writeJournal(value, expectedRevision, {
        get journal() { return journal },
        setJournal(next) { journal = structuredClone(next) },
        calls,
      })
      if ((journal?.revision ?? null) !== expectedRevision) throw new TypeError('CAS mismatch')
      journal = structuredClone(value)
      return structuredClone(journal)
    },
  })
  return { coordinator, calls, getJournal: () => structuredClone(journal) }
}

test('observes current evidence without writing and returns only a current saved plan', async () => {
  const state = fixture()
  assert.deepEqual(await state.coordinator.get(), {
    ok: true,
    code: 'observed',
    message: 'Read-only commissioning state observed. No configuration was changed.',
    snapshot: snapshot(),
    plan: null,
    journalRevision: null,
  })
  assert.deepEqual(state.calls, ['collect', 'read'])
  assert.equal(Object.hasOwn(state.coordinator, 'apply'), false)
  assert.equal(Object.hasOwn(state.coordinator, 'confirm'), false)
})

test('double-collects stable evidence, writes one CAS journal, and reports an external-agent visible-UI plan', async () => {
  const state = fixture({ snapshots: [snapshot(), snapshot({}, '2026-09-04T20:00:01.000Z')] })
  const result = await state.coordinator.prepare()
  assert.equal(result.ok, true)
  assert.equal(result.code, 'plan_prepared')
  assert.equal(result.plan.outcome, 'ready')
  assert.equal(result.plan.authority, 'external_agent_visible_ui')
  assert.equal(result.plan.writesAuthorized, false)
  assert.equal(result.journalRevision, 1)
  assert.equal(state.getJournal().revision, 1)
  assert.deepEqual(state.calls, ['collect', 'collect', 'read', 'write', 'read'])
})

test('fails closed on double-collect drift without persisting a plan', async () => {
  const state = fixture({ snapshots: [
    snapshot(),
    snapshot({ receiver: { status: 'multiple', inputMonitoring: 'granted' } }, '2026-09-04T20:00:01.000Z'),
  ] })
  const result = await state.coordinator.prepare()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'evidence_drift')
  assert.equal(result.snapshot.receiver.status, 'multiple')
  assert.equal(result.plan, null)
  assert.equal(state.calls.includes('write'), false)
  assert.equal(state.getJournal(), null)
})

test('serializes overlapping preparations and advances the journal with CAS', async () => {
  let active = 0
  let maxActive = 0
  const state = fixture({
    collectSnapshot: async ({ collection }) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setImmediate(resolve))
      active -= 1
      return snapshot({}, new Date(Date.parse('2026-09-04T20:00:00.000Z') + collection * 1000).toISOString())
    },
  })
  const [first, second] = await Promise.all([state.coordinator.prepare(), state.coordinator.prepare()])
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(first.journalRevision, 1)
  assert.equal(second.journalRevision, 2)
  assert.equal(maxActive, 1)
  assert.equal(state.getJournal().revision, 2)
})

test('returns bounded fail-closed results for invalid evidence, asynchronous reads, and failed verification', async () => {
  const invalidEvidence = fixture({ collectSnapshot: () => ({ raw: 'private' }) })
  assert.equal((await invalidEvidence.coordinator.get()).code, 'evidence_unavailable')
  assert.equal((await invalidEvidence.coordinator.prepare()).code, 'plan_unavailable')

  const asynchronousRead = fixture({ readJournal: () => Promise.resolve(null) })
  assert.equal((await asynchronousRead.coordinator.get()).code, 'evidence_unavailable')

  const failedWrite = fixture({ writeJournal: () => ({ malformed: true }) })
  const result = await failedWrite.coordinator.prepare()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'plan_unavailable')
  assert.equal(result.plan, null)
})

test('rejects missing dependencies and does not trust a competing in-memory writer', async () => {
  assert.throws(() => createCommissioningOperationCoordinator({}), /collectSnapshot/)
  const state = fixture({
    writeJournal: (value, expectedRevision, controls) => {
      controls.setJournal({ ...value, revision: 99 })
      if (!isDeepStrictEqual(controls.journal?.revision ?? null, expectedRevision)) throw new TypeError('CAS mismatch')
      return value
    },
  })
  assert.equal((await state.coordinator.prepare()).code, 'plan_unavailable')
})
