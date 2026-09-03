const test = require('node:test')
const assert = require('node:assert/strict')
const { isDeepStrictEqual } = require('node:util')
const {
  acceptNativeAcceptance,
  evaluateNativeAcceptance,
  prepareNativeAcceptance,
  stageNativeAcceptance,
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
    readReceipt: () => {
      calls.push('read')
      return overrides.readReceipt ? overrides.readReceipt({ receipt, evidence, calls }) : clone(receipt)
    },
    collectEvidence: async () => {
      calls.push('collect')
      return overrides.collectEvidence ? overrides.collectEvidence({ receipt, evidence, calls, setReceipt(value) { receipt = value }, setEvidence(value) { evidence = value } }) : clone(evidence)
    },
    prepareReceipt: (value) => prepareNativeAcceptance(value, '2026-09-03T00:00:00.000Z'),
    stageReceipt: (value, options) => stageNativeAcceptance(value, {
      ...options,
      stagedAt: '2026-09-03T00:02:00.000Z',
    }),
    acceptReceipt: (value, options) => acceptNativeAcceptance(value, {
      ...options,
      acceptedAt: '2026-09-03T00:02:00.000Z',
    }),
    evaluateReceipt: (value, options) => evaluateNativeAcceptance(value, {
      ...options,
      now: '2026-09-03T00:03:00.000Z',
    }),
    writeReceipt: async (value, expected) => {
      calls.push('write')
      const controls = { get receipt() { return receipt }, setReceipt(value) { receipt = value }, setEvidence(value) { evidence = value }, calls }
      if (overrides.writeReceipt) return overrides.writeReceipt(value, expected, controls)
      if (!isDeepStrictEqual(receipt, expected)) throw new TypeError('conditional receipt mismatch')
      receipt = clone(value)
      return clone(receipt)
    },
    removeReceipt: async (expected) => {
      calls.push('remove')
      const controls = { get receipt() { return receipt }, setReceipt(value) { receipt = value }, calls }
      if (overrides.removeReceipt) return overrides.removeReceipt(expected, controls)
      if (!isDeepStrictEqual(receipt, expected)) return false
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
  assert.deepEqual(state.calls, ['collect', 'read', 'collect', 'read', 'write', 'collect', 'read'])
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

test('acceptance promotes from one final evidence sample without a post-promotion probe', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const state = fixture({ receipt: prepared })
  const result = await state.coordinator.accept(attestations)

  assert.equal(result.ok, true)
  assert.equal(result.snapshot.receipt.state, 'accepted')
  assert.equal(result.snapshot.evaluation.status, 'accepted')
  assert.deepEqual(state.calls, ['collect', 'read', 'collect', 'read', 'write', 'collect', 'read', 'write'])
})

test('acceptance detects a receipt replacement during final pre-write evidence collection', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const replacement = prepareNativeAcceptance(context, '2026-09-03T00:00:30.000Z')
  let collections = 0
  const state = fixture({
    receipt: prepared,
    collectEvidence: (controls) => {
      collections += 1
      if (collections === 2) controls.setReceipt(clone(replacement))
      return { currentContext: context, nativeInitialization: connected }
    },
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /changed while acceptance/)
  assert.equal(state.calls.includes('write'), false)
  assert.deepEqual(state.getReceipt(), replacement)
})

test('post-write snapshot detects a receipt replacement during evidence collection', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const replacement = prepareNativeAcceptance(context, '2026-09-03T00:00:30.000Z')
  let collections = 0
  const state = fixture({
    receipt: prepared,
    collectEvidence: (controls) => {
      collections += 1
      if (collections === 3) controls.setReceipt(clone(replacement))
      return { currentContext: context, nativeInitialization: connected }
    },
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /changed while acceptance/)
  assert.deepEqual(result.snapshot.receipt, replacement)
  assert.deepEqual(state.getReceipt(), replacement)
})

test('conditional acceptance does not overwrite a competing writer after validation', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const competing = prepareNativeAcceptance(context, '2026-09-03T00:00:30.000Z')
  const state = fixture({
    receipt: prepared,
    writeReceipt: (value, expected, controls) => {
      controls.setReceipt(clone(competing))
      if (!isDeepStrictEqual(controls.receipt, expected)) throw new TypeError('conditional receipt mismatch')
      controls.setReceipt(clone(value))
      return clone(value)
    },
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.deepEqual(state.getReceipt(), competing)
  assert.deepEqual(result.snapshot.receipt, competing)
})

test('context drift after staging leaves a durable non-accepted receipt that cannot resurrect', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  let collections = 0
  const state = fixture({
    receipt: prepared,
    collectEvidence: (controls) => {
      collections += 1
      if (collections === 3) {
        const changed = { currentContext: replacementContext, nativeInitialization: connected }
        controls.setEvidence(changed)
        return changed
      }
      return clone(controls.evidence)
    },
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /changed while acceptance|Fresh ordered initialization/)
  assert.equal(result.snapshot.receipt.state, 'accepting')
  assert.equal(result.snapshot.evaluation.reason, 'context_mismatch')

  state.setEvidence({ currentContext: context, nativeInitialization: connected })
  const restored = await state.coordinator.get()
  assert.equal(restored.receipt.state, 'accepting')
  assert.equal(restored.evaluation.status, 'pending')
  assert.notEqual(restored.evaluation.status, 'accepted')
})

test('a throwing promotion leaves only the non-accepted staged receipt', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  let writes = 0
  const state = fixture({
    receipt: prepared,
    writeReceipt: (value, expected, controls) => {
      writes += 1
      if (!isDeepStrictEqual(controls.receipt, expected)) throw new TypeError('conditional receipt mismatch')
      if (writes === 2) throw new TypeError('promotion storage unavailable')
      controls.setReceipt(clone(value))
      return clone(value)
    },
  })
  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.equal(state.getReceipt().state, 'accepting')
  assert.equal(result.snapshot.receipt.state, 'accepting')
  assert.equal(result.snapshot.evaluation.status, 'pending')

  state.setEvidence({ currentContext: context, nativeInitialization: connected })
  const restored = await state.coordinator.get()
  assert.equal(restored.receipt.state, 'accepting')
  assert.notEqual(restored.evaluation.status, 'accepted')
})

test('a never-settling promotion exposes only the non-accepted staged receipt', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  let writes = 0
  const never = new Promise(() => {})
  const state = fixture({
    receipt: prepared,
    writeReceipt: (value, expected, controls) => {
      writes += 1
      if (!isDeepStrictEqual(controls.receipt, expected)) throw new TypeError('conditional receipt mismatch')
      if (writes === 2) return never
      controls.setReceipt(clone(value))
      return clone(value)
    },
  })

  void state.coordinator.accept(attestations)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(writes, 2)
  assert.equal(state.getReceipt().state, 'accepting')
  assert.equal(evaluateNativeAcceptance(state.getReceipt(), {
    currentContext: context,
    nativeInitialization: connected,
    now: '2026-09-03T00:03:00.000Z',
  }).status, 'pending')
})

test('promotion CAS never overwrites a competing receipt', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const competing = prepareNativeAcceptance(context, '2026-09-03T00:00:30.000Z')
  let writes = 0
  const state = fixture({
    receipt: prepared,
    writeReceipt: (value, expected, controls) => {
      writes += 1
      if (writes === 1) {
        assert.deepEqual(expected, prepared)
        controls.setReceipt(clone(value))
        return clone(value)
      }
      controls.setReceipt(clone(competing))
      if (!isDeepStrictEqual(controls.receipt, expected)) throw new TypeError('conditional receipt mismatch')
      controls.setReceipt(clone(value))
      return clone(value)
    },
  })

  const result = await state.coordinator.accept(attestations)
  assert.equal(result.ok, false)
  assert.match(result.message, /No acceptance was recorded/)
  assert.deepEqual(state.getReceipt(), competing)
  assert.deepEqual(result.snapshot.receipt, competing)
})

test('acceptance and route mutation share one queue', async () => {
  const gate = deferred()
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const state = fixture({
    receipt: prepared,
    writeReceipt: async (value, _expected, controls) => {
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
    writeReceipt: async (value, _expected, controls) => {
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
    removeReceipt: (_expected, controls) => {
      controls.setReceipt(prepared)
      return true
    },
  })
  const result = await state.coordinator.clear()
  assert.equal(result.ok, false)
  assert.deepEqual(result.snapshot.receipt, prepared)
  assert.match(result.message, /could not be cleared safely/)
})

test('conditional clear does not remove a competing writer', async () => {
  const prepared = prepareNativeAcceptance(context, '2026-09-03T00:00:00.000Z')
  const competing = prepareNativeAcceptance(context, '2026-09-03T00:00:30.000Z')
  const state = fixture({
    receipt: prepared,
    removeReceipt: (expected, controls) => {
      controls.setReceipt(clone(competing))
      return isDeepStrictEqual(controls.receipt, expected)
    },
  })
  const result = await state.coordinator.clear()
  assert.equal(result.ok, false)
  assert.deepEqual(state.getReceipt(), competing)
  assert.deepEqual(result.snapshot.receipt, competing)
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
  const asyncRead = fixture({ readReceipt: () => Promise.resolve(null) })
  const failed = await asyncRead.coordinator.get()
  assert.equal(failed.receipt, null)
  assert.equal(failed.evaluation.status, 'not_prepared')
})
