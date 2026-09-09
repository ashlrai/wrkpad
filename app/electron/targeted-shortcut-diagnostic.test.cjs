const assert = require('node:assert/strict')
const test = require('node:test')
const {
  TARGET_ACCELERATOR,
  TARGET_ROUTE,
  TARGET_SIGNAL_ID,
  createTargetedShortcutDiagnostic,
  createTargetedShortcutProbeCoordinator,
} = require('./targeted-shortcut-diagnostic.cjs')

const ownership = (overrides = {}) => ({ generation: 4, totalObserved: 10, scope: TARGET_ROUTE, ...overrides })
const attempt = (source, callback, mappedResult = 'pending', overrides = {}) => ({
  generation: 4,
  source,
  callback,
  mappedResult,
  ...(callback === 'silent' ? {} : { signalId: TARGET_SIGNAL_ID, accelerator: TARGET_ACCELERATOR }),
  ...overrides,
})

test('starts with a bounded current-generation ownership snapshot and no identity claim', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  assert.equal(diagnostic.snapshot().outcome, 'pending')
  assert.equal(diagnostic.start(ownership()), true)
  assert.deepEqual(diagnostic.snapshot(), {
    target: { signalId: 'joyRight', accelerator: 'Control+Alt+Command+Right', route: 'ashlr_layer' },
    ownership: { generation: 4, baselineObservedCount: 10, observedCount: 10, observedDelta: 0, scope: 'ashlr_layer' },
    attempts: { physical: null, synthetic: null },
    outcome: 'pending',
    deviceIdentityClaimed: false,
  })
})

test('classifies an allowed target callback with a mapped result as working', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  diagnostic.start(ownership())
  diagnostic.updateOwnership(ownership({ totalObserved: 11 }))
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'allowed', 'succeeded')), true)
  assert.equal(diagnostic.snapshot().outcome, 'working')
})

test('classifies an allowed callback with an explicitly missing mapped result as app dispatch failure', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  diagnostic.start(ownership())
  diagnostic.updateOwnership(ownership({ totalObserved: 11 }))
  assert.equal(diagnostic.attestAttempt(attempt('synthetic', 'allowed', 'missing')), true)
  assert.equal(diagnostic.snapshot().outcome, 'app_dispatch_failure')
})

test('separates physical emission failure from receiver or permission failure', () => {
  const physicalFailure = createTargetedShortcutDiagnostic()
  physicalFailure.start(ownership())
  physicalFailure.updateOwnership(ownership({ totalObserved: 11 }))
  physicalFailure.attestAttempt(attempt('synthetic', 'allowed'))
  physicalFailure.attestAttempt(attempt('physical', 'silent'))
  assert.equal(physicalFailure.snapshot().outcome, 'physical_emission_failure')

  const receiverFailure = createTargetedShortcutDiagnostic()
  receiverFailure.start(ownership())
  receiverFailure.attestAttempt(attempt('synthetic', 'silent'))
  receiverFailure.attestAttempt(attempt('physical', 'silent'))
  assert.equal(receiverFailure.snapshot().outcome, 'receiver_or_permission_failure')
})

test('classifies the wrong ownership scope or an explicitly rejected callback as rejected route', () => {
  const wrongScope = createTargetedShortcutDiagnostic()
  wrongScope.start(ownership({ scope: 'codex_native' }))
  assert.equal(wrongScope.snapshot().outcome, 'rejected_route')

  const rejected = createTargetedShortcutDiagnostic()
  rejected.start(ownership())
  rejected.updateOwnership(ownership({ totalObserved: 11 }))
  rejected.attestAttempt(attempt('physical', 'rejected'))
  assert.equal(rejected.snapshot().outcome, 'rejected_route')
})

test('keeps incomplete or uncorroborated evidence pending', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  diagnostic.start(ownership())
  diagnostic.attestAttempt(attempt('physical', 'silent'))
  assert.equal(diagnostic.snapshot().outcome, 'pending')

  diagnostic.updateOwnership(ownership({ totalObserved: 11 }))
  diagnostic.attestAttempt(attempt('synthetic', 'allowed'))
  assert.equal(diagnostic.snapshot().outcome, 'physical_emission_failure')
})

test('rotates generation atomically and rejects stale-generation attestations', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  diagnostic.start(ownership())
  diagnostic.updateOwnership(ownership({ totalObserved: 11 }))
  diagnostic.attestAttempt(attempt('physical', 'allowed', 'succeeded'))
  assert.equal(diagnostic.snapshot().outcome, 'working')

  assert.equal(diagnostic.updateOwnership(ownership({ generation: 5, totalObserved: 2 })), true)
  assert.deepEqual(diagnostic.snapshot().ownership, {
    generation: 5, baselineObservedCount: 2, observedCount: 2, observedDelta: 0, scope: TARGET_ROUTE,
  })
  assert.deepEqual(diagnostic.snapshot().attempts, { physical: null, synthetic: null })
  assert.equal(diagnostic.snapshot().outcome, 'pending')
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'allowed', 'succeeded')), false)
})

test('rejects malformed ownership, stale counters, wrong targets, and contradictory attestations', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  for (const invalid of [null, {}, ownership({ generation: -1 }), ownership({ totalObserved: -1 }), ownership({ scope: 'INVALID' })]) {
    assert.equal(diagnostic.start(invalid), false)
  }

  assert.equal(diagnostic.start(ownership()), true)
  assert.equal(diagnostic.updateOwnership(ownership({ totalObserved: 9 })), false)
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'allowed', 'succeeded')), false)
  assert.equal(diagnostic.snapshot().outcome, 'pending')
  assert.equal(diagnostic.updateOwnership(ownership({ totalObserved: 11 })), true)
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'allowed', 'succeeded', { signalId: 'joyLeft' })), false)
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'allowed', 'succeeded', { accelerator: 'changed' })), false)
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'silent', 'succeeded')), false)
  assert.equal(diagnostic.attestAttempt(attempt('physical', 'rejected', 'missing')), false)
  assert.equal(diagnostic.attestAttempt(attempt('unknown', 'silent')), false)
})

test('returns defensive snapshots and supports explicit reset', () => {
  const diagnostic = createTargetedShortcutDiagnostic()
  diagnostic.start(ownership())
  diagnostic.attestAttempt(attempt('physical', 'silent'))
  const snapshot = diagnostic.snapshot()
  snapshot.ownership.scope = 'changed'
  snapshot.attempts.physical.callback = 'allowed'
  assert.equal(diagnostic.snapshot().ownership.scope, TARGET_ROUTE)
  assert.equal(diagnostic.snapshot().attempts.physical.callback, 'silent')

  diagnostic.reset()
  assert.equal(diagnostic.snapshot().ownership, null)
  assert.equal(diagnostic.snapshot().outcome, 'pending')
})

function probeHarness() {
  let clock = new Date('2026-09-08T22:00:00.000Z')
  let nextTimer = 0
  const timers = new Map()
  return {
    coordinator: createTargetedShortcutProbeCoordinator({
      now: () => clock,
      setTimer: (callback) => { const id = ++nextTimer; timers.set(id, callback); return id },
      clearTimer: (id) => timers.delete(id),
      timeoutMs: 10_000,
    }),
    advance(iso) { clock = new Date(iso) },
    fireTimers() { for (const callback of [...timers.values()]) callback() },
  }
}

test('probe consumes only the exact current-generation joystick-right callback', async () => {
  const harness = probeHarness()
  const promise = harness.coordinator.start({ instructedInput: 'mac_keyboard', ownership: ownership() })
  assert.equal(harness.coordinator.active(), true)
  assert.equal(harness.coordinator.observe({ signalId: 'joyLeft', generation: 4, scope: TARGET_ROUTE, observedAt: '2026-09-08T22:00:01.000Z' }), false)
  assert.equal(harness.coordinator.observe({ signalId: TARGET_SIGNAL_ID, generation: 5, scope: TARGET_ROUTE, observedAt: '2026-09-08T22:00:01.000Z' }), false)
  assert.equal(harness.coordinator.observe({ signalId: TARGET_SIGNAL_ID, generation: 4, scope: TARGET_ROUTE, observedAt: '2026-09-08T22:00:01.000Z' }), true)
  assert.deepEqual(await promise, {
    schemaVersion: 1, target: 'joyRight', instructedInput: 'mac_keyboard', status: 'os_callback_observed',
    generation: 4, startedAt: '2026-09-08T22:00:00.000Z', observedAt: '2026-09-08T22:00:01.000Z', delivery: 'allowed',
  })
  assert.equal(harness.coordinator.active(), false)
})

test('probe times out without inventing an input source', async () => {
  const harness = probeHarness()
  const promise = harness.coordinator.start({ instructedInput: 'creator_micro_2', ownership: ownership() })
  harness.fireTimers()
  const result = await promise
  assert.equal(result.status, 'timed_out')
  assert.equal(result.delivery, 'none')
  assert.equal(Object.hasOwn(result, 'source'), false)
  assert.equal(Object.hasOwn(result, 'deviceIdentityClaimed'), false)
})

test('probe blocks invalid ownership and non-Ashlr scope', async () => {
  const harness = probeHarness()
  assert.equal((await harness.coordinator.start({ instructedInput: 'bad', ownership: ownership() })).status, 'blocked')
  assert.equal((await harness.coordinator.start({ instructedInput: 'mac_keyboard', ownership: ownership({ scope: 'codex_native' }) })).status, 'blocked')
  assert.equal(harness.coordinator.active(), false)
})

test('starting a second probe supersedes the first and invalidation settles the second', async () => {
  const harness = probeHarness()
  const first = harness.coordinator.start({ instructedInput: 'mac_keyboard', ownership: ownership() })
  harness.advance('2026-09-08T22:00:02.000Z')
  const second = harness.coordinator.start({ instructedInput: 'creator_micro_2', ownership: ownership() })
  assert.equal((await first).status, 'superseded')
  assert.equal(harness.coordinator.invalidate(), true)
  assert.equal((await second).status, 'invalidated')
  assert.equal(harness.coordinator.invalidate(), false)
})
