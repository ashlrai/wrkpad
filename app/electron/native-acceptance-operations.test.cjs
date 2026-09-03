const test = require('node:test')
const assert = require('node:assert/strict')
const {
  acceptNativeAcceptance,
  evaluateNativeAcceptance,
  prepareNativeAcceptance,
} = require('./native-acceptance-receipt.cjs')
const { createNativeAcceptanceOperationCoordinator } = require('./native-acceptance-operations.cjs')

const context = Object.freeze({
  route: 'codex_native',
  device: { vidPid: '303A:8298' },
  codex: { version: '26.818.61809', build: '7019' },
})
const replacementContext = Object.freeze({
  route: 'codex_native',
  device: { vidPid: '303A:8298' },
  codex: { version: '26.819.00000', build: '7020' },
})
const connected = Object.freeze({
  status: 'connected',
  observedAt: '2026-09-03T00:01:00.000Z',
  fresh: true,
})
const disconnected = Object.freeze({
  status: 'disconnected',
  observedAt: '2026-09-03T00:01:00.000Z',
  fresh: true,
})
const attestations = Object.freeze({
  settingsConnected: true,
  dial: true,
  joystick: true,
  agentKeys: true,
  actionKeys: true,
  microphone: true,
  lighting: true,
})

function clone(value) {
  return value === null || value === undefined ? value : structuredClone(value)
}

function deferred() {
  let resolve
  const promise = new Promise((complete) => { resolve = complete })
  return { promise, resolve }
}

function fixture(overrides = {}) {
  let receipt = overrides.receipt ?? null
  let evidence = overrides.evidence ?? { currentContext: context, nativeInitialization: connected }
  const calls = []
  const coordinator = createNativeAcceptanceOperationCoordinator({
    readReceipt: async () => {
      calls.push('read')
      return overrides.readReceipt ? overrides.readReceipt({ receipt, evidence, calls }) : clone(receipt)
    },
    collectEvidence: async () => {
      calls.push('collect')
      return overrides.collectEvidence ? overrides.collectEvidence({ receipt, evidence, calls }) : clone(evidence)
    },
    prepareReceipt: (value) => prepareNativeAcceptance(value, '2026-09-03T00:00:00.000Z'),
    acceptReceipt: (value, options) => acceptNativeAcceptance(value, {
      ...options,
      acceptedAt: '2026-09-03T00:02:00.000Z',
    }),
    evaluateReceipt: (value, options) => evaluateNativeAcceptance(value, {
      ...options,
      now: '2026-09-03T00:03:00.000Z',
    }),
    writeReceipt: async (value) => {
      calls.push('write')
      if (overrides.writeReceipt) return overrides.writeReceipt(value, { get receipt() { return receipt }, setReceipt(value) { receipt = value }, setEvidence(value) { evidence = value }, calls })
      receipt = clone(value)
      return clone(receipt)
    },
    removeReceipt: async () => {
      calls.push('remove')
      if (overrides.removeReceipt) return overrides.removeReceipt({ get receipt() { return receipt }, setReceipt(value) { receipt = value }, calls })
      receipt = null
      return true
    },
  })
  return {
    coordinator,
    calls,
    getReceipt: () => clone(receipt),
    setReceipt: (value) => { receipt = clone(value) },
    setEvidence: (value) => { evidence = clone(value) },
  }
}

test('preparation double-checks receipt and context before writing, then returns a fresh snapshot', async () => {
  const state = fixture()
  const result = await state.coordinator.prepare()
  assert.equal(result.ok, true)
  assert.equal(result.snapshot.receipt.state, 'prepared')
  assert.equal(result.snapshot.evaluation.status, 'initialization_observed')
  assert.deepEqual(state.calls, ['read', 'collect', 'read', 'collect', 'write', 'read', 'collect'])
})

test('preparation rejects a receipt changed during its validation window', async () => {
  const foreign = prepareNativeAcceptance(context, '2026-09-02T23:59:00.000Z')
  let reads = 0
  const state = fixture({
    readReceipt: () => (++reads === 1 ? null : foreign),
  })
  const result = await state.coordinator.prepare()
  assert.equal(result.ok, false)
  assert.match(result.message, /changed while preparation/)
  assert.equal(state.calls.includes('write'), false)
  assert.deepEqual(result.snapshot.receipt, foreign)
})

test('acceptance rejects a context changed during its validation window without writing', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  let collections = 0
  const state = fixture({
    receipt: prepared,
    collectEvidence: () => ({
      currentContext: ++collections === 1 ? context : replacementContext,
      nativeInitialization: connected,
    }),
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /changed while acceptance/)
  assert.equal(state.calls.includes('write'), false)
  assert.equal(result.snapshot.evaluation.reason, 'context_mismatch')
})

test('acceptance evaluates the final initialization evidence immediately before persistence', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  let collections = 0
  const state = fixture({
    receipt: prepared,
    collectEvidence: () => ({
      currentContext: context,
      nativeInitialization: ++collections === 1 ? connected : disconnected,
    }),
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /Fresh ordered initialization/)
  assert.equal(state.calls.includes('write'), false)
  assert.equal(result.snapshot.evaluation.reason, 'initialization_disconnected')
})

test('acceptance cannot return stale success when context changes after persistence', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const state = fixture({
    receipt: prepared,
    writeReceipt: (value, controls) => {
      controls.setReceipt(clone(value))
      controls.setEvidence({ currentContext: replacementContext, nativeInitialization: connected })
      return clone(value)
    },
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /changed while acceptance/)
  assert.equal(result.snapshot.receipt.state, 'accepted')
  assert.equal(result.snapshot.evaluation.reason, 'context_mismatch')
})

test('acceptance and route mutation share one queue', async () => {
  const gate = deferred()
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const state = fixture({
    receipt: prepared,
    writeReceipt: async (value, controls) => {
      controls.calls.push('write-wait')
      await gate.promise
      controls.setReceipt(clone(value))
      return clone(value)
    },
  })
  const accepting = state.coordinator.accept(attestations)
  const mutating = state.coordinator.mutateContext(() => {
    state.calls.push('mutate')
    return 'input_managed'
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.calls.includes('mutate'), false)
  gate.resolve()
  assert.equal((await accepting).ok, true)
  assert.equal(await mutating, 'input_managed')
  assert.equal(state.calls.at(-1), 'mutate')
})

test('clear is serialized after preparation and verifies the post-removal snapshot', async () => {
  const gate = deferred()
  const state = fixture({
    writeReceipt: async (value, controls) => {
      await gate.promise
      controls.setReceipt(clone(value))
      return clone(value)
    },
  })
  const preparing = state.coordinator.prepare()
  const clearing = state.coordinator.clear()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(state.calls.includes('remove'), false)
  gate.resolve()
  assert.equal((await preparing).ok, true)
  const cleared = await clearing
  assert.equal(cleared.ok, true)
  assert.equal(cleared.snapshot.receipt, null)
})

test('clear does not claim success if a receipt exists in the fresh snapshot', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const state = fixture({
    receipt: prepared,
    removeReceipt: (controls) => {
      controls.setReceipt(prepared)
      return true
    },
  })
  const result = await state.coordinator.clear()
  assert.equal(result.ok, false)
  assert.deepEqual(result.snapshot.receipt, prepared)
  assert.match(result.message, /could not be cleared safely/)
})

test('dependency failures are sanitized and do not expose raw local content', async () => {
  const secret = '/Users/example/private/repo prompt title session-id'
  const state = fixture({ collectEvidence: () => { throw new Error(secret) } })
  const result = await state.coordinator.prepare()
  const serialized = JSON.stringify(result)
  assert.equal(result.ok, false)
  assert.doesNotMatch(serialized, /Users|example|repo prompt|title|session-id/)
})

test('coordinator validates dependencies and context mutation callbacks', async () => {
  assert.throws(() => createNativeAcceptanceOperationCoordinator({}), /must be a function/)
  const state = fixture()
  await assert.rejects(state.coordinator.mutateContext(null), /context mutation must be a function/)
})
