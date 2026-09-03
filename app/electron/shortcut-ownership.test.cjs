const test = require('node:test')
const assert = require('node:assert/strict')
const { createShortcutCallbackGuard, createShortcutOwnershipController } = require('./shortcut-ownership.cjs')

function fixture() {
  const calls = { clear: 0, inspect: 0, register: 0, reset: 0, unregister: 0 }
  let runtime = { status: 'exclusive' }
  const controller = createShortcutOwnershipController({
    clearApprovals: () => { calls.clear += 1 },
    expectedRegistrationCount: () => 2,
    inspectRuntime: () => { calls.inspect += 1; return runtime },
    registerShortcuts: () => {
      calls.register += 1
      return [{ signalId: 'one', registered: true }, { signalId: 'two', registered: true }]
    },
    registrationsAreActive: () => true,
    resetFlight: () => { calls.reset += 1 },
    runtimeOwnsShortcuts: (candidate, route) => candidate.status === 'exclusive'
      && (route !== 'hybrid_native' || candidate.inputApplication?.status === 'not_running'),
    routeOwnsShortcuts: (route) => route === 'ashlr_layer' || route === 'hybrid_native',
    shortcutsAreReleased: () => true,
    unregisterAll: () => { calls.unregister += 1 },
  })
  return { calls, controller, setRuntime: (value) => { runtime = value } }
}

test('startup never registers shortcuts before the Ashlr Layer route is declared', () => {
  for (const route of ['unknown', 'codex_native']) {
    const { calls, controller } = fixture()
    const state = controller.synchronize(route)
    assert.deepEqual(state.registrations, [])
    assert.equal(calls.register, 0)
    assert.equal(calls.unregister, 1)
    assert.equal(calls.reset, 1)
    assert.equal(calls.clear, 1)
  }
})

test('switching to Codex Native unregisters every owned shortcut and clears guarded state', () => {
  const { calls, controller } = fixture()
  assert.equal(controller.synchronize('ashlr_layer').registrations.length, 2)
  assert.equal(calls.register, 1)

  const passive = controller.synchronize('codex_native')
  assert.deepEqual(passive.registrations, [])
  assert.equal(calls.unregister, 1)
  assert.equal(calls.reset, 1)
  assert.equal(calls.clear, 1)

  controller.synchronize('codex_native')
  assert.equal(calls.register, 1)
})

test('switching back to Ashlr Layer re-inspects ownership before registration', () => {
  const { calls, controller, setRuntime } = fixture()
  controller.synchronize('codex_native')
  setRuntime({ status: 'contended' })
  assert.deepEqual(controller.synchronize('ashlr_layer').registrations, [])
  assert.equal(calls.register, 0)

  setRuntime({ status: 'exclusive' })
  const active = controller.synchronize('ashlr_layer')
  assert.equal(active.registrations.length, 2)
  assert.equal(calls.register, 1)
  assert.equal(calls.inspect, 3)
})

test('switching between full and Hybrid Native ownership replaces registrations and guarded state', () => {
  const calls = { clear: 0, register: [], reset: 0, unregister: 0 }
  const controller = createShortcutOwnershipController({
    clearApprovals: () => { calls.clear += 1 },
    expectedRegistrationCount: (route) => route === 'hybrid_native' ? 1 : 2,
    inspectRuntime: () => ({ status: 'exclusive', inputApplication: { status: 'not_running' } }),
    registerShortcuts: (route) => {
      calls.register.push(route)
      return route === 'hybrid_native'
        ? [{ signalId: 'cmd1', registered: true }]
        : [{ signalId: 'agent1', registered: true }, { signalId: 'cmd1', registered: true }]
    },
    registrationsAreActive: () => true,
    resetFlight: () => { calls.reset += 1 },
    runtimeOwnsShortcuts: () => true,
    routeOwnsShortcuts: (route) => route === 'ashlr_layer' || route === 'hybrid_native',
    shortcutsAreReleased: () => true,
    unregisterAll: () => { calls.unregister += 1 },
  })

  assert.deepEqual(controller.synchronize('ashlr_layer').registrations.map((item) => item.signalId), ['agent1', 'cmd1'])
  assert.deepEqual(controller.synchronize('hybrid_native').registrations.map((item) => item.signalId), ['cmd1'])
  assert.deepEqual(calls.register, ['ashlr_layer', 'hybrid_native'])
  assert.equal(calls.unregister, 1)
  assert.equal(calls.reset, 1)
  assert.equal(calls.clear, 1)
})

test('Hybrid Native refuses ownership unless Input is explicitly not running', () => {
  for (const status of ['running', 'unavailable']) {
    const { calls, controller, setRuntime } = fixture()
    setRuntime({ status: 'exclusive', inputApplication: { status } })
    const state = controller.synchronize('hybrid_native')
    assert.deepEqual(state.registrations, [])
    assert.equal(calls.register, 0)
  }
})

test('failed or incomplete registrations are retried only on Ashlr Layer', () => {
  let attempts = 0
  let unregisters = 0
  const controller = createShortcutOwnershipController({
    clearApprovals() {},
    expectedRegistrationCount: () => 2,
    inspectRuntime: () => ({ status: 'exclusive' }),
    registerShortcuts: () => {
      attempts += 1
      return [{ signalId: 'one', registered: true }, { signalId: 'two', registered: attempts > 1 }]
    },
    registrationsAreActive: () => true,
    resetFlight() {},
    runtimeOwnsShortcuts: () => true,
    routeOwnsShortcuts: (route) => route === 'ashlr_layer',
    shortcutsAreReleased: () => true,
    unregisterAll() { unregisters += 1 },
  })

  assert.deepEqual(controller.synchronize('ashlr_layer').registrations, [])
  assert.equal(unregisters, 1)
  assert.equal(controller.synchronize('ashlr_layer').registrations[1].registered, true)
  controller.synchronize('codex_native')
  controller.synchronize('unknown')
  assert.equal(attempts, 2)
})

test('validates dependency and registration contracts', () => {
  assert.throws(() => createShortcutOwnershipController({}), /must be a function/)
  const controller = createShortcutOwnershipController({
    clearApprovals() {}, expectedRegistrationCount: () => 1, inspectRuntime: () => ({}),
    registerShortcuts: () => null, resetFlight() {}, runtimeOwnsShortcuts: () => true,
    registrationsAreActive: () => true, routeOwnsShortcuts: (route) => route === 'ashlr_layer', shortcutsAreReleased: () => true,
    unregisterAll() {},
  })
  assert.deepEqual(controller.synchronize('ashlr_layer').registrations, [])
})

test('a throwing registration attempt is immediately cleaned up and remains retryable', () => {
  let attempts = 0
  let unregisters = 0
  const controller = createShortcutOwnershipController({
    clearApprovals() {}, expectedRegistrationCount: () => 1, inspectRuntime: () => ({ status: 'exclusive' }),
    registerShortcuts: () => {
      attempts += 1
      if (attempts === 1) throw new Error('partial Electron registration')
      return [{ signalId: 'one', registered: true }]
    },
    registrationsAreActive: () => true,
    resetFlight() {}, runtimeOwnsShortcuts: () => true, routeOwnsShortcuts: (route) => route === 'ashlr_layer',
    shortcutsAreReleased: () => true,
    unregisterAll: () => { unregisters += 1 },
  })

  assert.deepEqual(controller.synchronize('ashlr_layer').registrations, [])
  assert.equal(unregisters, 1)
  assert.equal(controller.synchronize('ashlr_layer').registrations.length, 1)
})

test('native state reports an unregister failure instead of trusting empty bookkeeping', () => {
  const controller = createShortcutOwnershipController({
    clearApprovals() {}, expectedRegistrationCount: () => 1, inspectRuntime: () => ({ status: 'exclusive' }),
    registerShortcuts: () => [{ signalId: 'one', registered: true }],
    registrationsAreActive: () => true, resetFlight() {}, runtimeOwnsShortcuts: () => true, routeOwnsShortcuts: (route) => route === 'ashlr_layer',
    shortcutsAreReleased: () => false, unregisterAll() {},
  })

  assert.deepEqual(controller.synchronize('codex_native'), {
    runtime: { status: 'exclusive' }, registrations: [], released: false,
  })
})

test('a captured callback cannot record, send, or act after its generation is invalidated', () => {
  const guard = createShortcutCallbackGuard()
  const effects = { action: 0, record: 0, send: 0 }
  const captured = guard.bind(() => {
    effects.record += 1
    effects.send += 1
    effects.action += 1
  })
  guard.enable()
  assert.equal(captured(), true)
  assert.deepEqual(effects, { action: 1, record: 1, send: 1 })

  guard.invalidate()
  guard.enable()
  effects.action = 0
  effects.record = 0
  effects.send = 0
  assert.equal(captured(), false)
  assert.deepEqual(effects, { action: 0, record: 0, send: 0 })
})

test('an unregister exception still clears flight evidence and approvals before failing closed', () => {
  const effects = { clear: 0, reset: 0 }
  const controller = createShortcutOwnershipController({
    clearApprovals: () => { effects.clear += 1 },
    expectedRegistrationCount: () => 1,
    inspectRuntime: () => ({ status: 'exclusive' }),
    registerShortcuts: () => [{ signalId: 'one', registered: true }],
    registrationsAreActive: () => true,
    resetFlight: () => { effects.reset += 1 },
    runtimeOwnsShortcuts: () => true,
    routeOwnsShortcuts: (route) => route === 'ashlr_layer',
    shortcutsAreReleased: () => false,
    unregisterAll: () => { throw new Error('Electron unregister failure') },
  })

  assert.throws(() => controller.synchronize('codex_native'), /unregister failure/)
  assert.deepEqual(effects, { clear: 1, reset: 1 })
})

test('a composed synchronization failure invalidates a previously enabled callback', () => {
  const guard = createShortcutCallbackGuard()
  let runtime = { status: 'exclusive' }
  let deliveries = 0
  const captured = guard.bind(() => { deliveries += 1 })
  const controller = createShortcutOwnershipController({
    clearApprovals() {}, expectedRegistrationCount: () => 1, inspectRuntime: () => runtime,
    registerShortcuts: () => [{ signalId: 'one', registered: true }],
    registrationsAreActive: () => true, resetFlight() {}, routeOwnsShortcuts: (route) => route === 'ashlr_layer',
    runtimeOwnsShortcuts: (candidate) => candidate.status === 'exclusive',
    shortcutsAreReleased: () => false,
    unregisterAll: () => { throw new Error('Electron unregister failure') },
  })
  const synchronize = (route) => {
    try {
      const state = controller.synchronize(route)
      if (route === 'ashlr_layer' && state.registrations.length === 1) guard.enable()
      else guard.invalidate()
      return state
    } catch (error) {
      guard.invalidate()
      throw error
    }
  }

  synchronize('ashlr_layer')
  assert.equal(captured(), true)
  runtime = { status: 'contended' }
  assert.throws(() => synchronize('ashlr_layer'), /unregister failure/)
  deliveries = 0
  assert.equal(captured(), false)
  assert.equal(deliveries, 0)
})
