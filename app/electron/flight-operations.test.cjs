const test = require('node:test')
const assert = require('node:assert/strict')
const { createFlightSession } = require('./flight-session.cjs')
const { createFlightOperationCoordinator, saveBoundFlightReceipt } = require('./flight-operations.cjs')

function deferred() {
  let resolve
  const promise = new Promise((settle) => { resolve = settle })
  return { promise, resolve }
}

async function activeCoordinator() {
  const times = ['2026-09-01T17:00:00.000Z', '2026-09-01T17:01:00.000Z']
  const session = createFlightSession(() => times.shift())
  const coordinator = createFlightOperationCoordinator(session)
  assert.deepEqual(await coordinator.start(async () => ({ ready: true })), {
    acknowledged: true,
    active: true,
    startedAt: '2026-09-01T17:00:00.000Z',
  })
  return { coordinator, session }
}

test('a later stop supersedes a pending start admission', async () => {
  const session = createFlightSession(() => '2026-09-01T17:00:00.000Z')
  const coordinator = createFlightOperationCoordinator(session)
  const gate = deferred()

  const pendingStart = coordinator.start(() => gate.promise)
  assert.deepEqual(coordinator.stop(), { acknowledged: true, active: false, startedAt: null })
  gate.resolve({ ready: true })

  assert.deepEqual(await pendingStart, { acknowledged: false, active: false, startedAt: null })
  assert.equal(session.isActive(), false)
})

test('a later restart supersedes an earlier pending restart', async () => {
  const { coordinator } = await activeCoordinator()
  const firstGate = deferred()
  const secondGate = deferred()
  const first = coordinator.restart(() => firstGate.promise)
  const second = coordinator.restart(() => secondGate.promise)

  firstGate.resolve({ ready: true })
  assert.deepEqual(await first, {
    acknowledged: false,
    active: true,
    startedAt: '2026-09-01T17:00:00.000Z',
  })

  secondGate.resolve({ ready: true })
  assert.deepEqual(await second, {
    acknowledged: true,
    active: true,
    startedAt: '2026-09-01T17:01:00.000Z',
  })
  assert.equal(coordinator.capture().generation, 3n)
})

test('a later restart supersedes a pending start admission', async () => {
  const session = createFlightSession(() => '2026-09-01T17:00:00.000Z')
  const coordinator = createFlightOperationCoordinator(session)
  const gate = deferred()
  const pendingStart = coordinator.start(() => gate.promise)

  assert.deepEqual(await coordinator.restart(async () => ({ ready: true })), {
    acknowledged: false,
    active: false,
    startedAt: null,
  })
  gate.resolve({ ready: true })

  assert.deepEqual(await pendingStart, { acknowledged: false, active: false, startedAt: null })
  assert.equal(session.isActive(), false)
})

test('a later stop supersedes a pending restart admission', async () => {
  const { coordinator, session } = await activeCoordinator()
  const gate = deferred()
  const pendingRestart = coordinator.restart(() => gate.promise)

  assert.deepEqual(coordinator.stop(), { acknowledged: true, active: false, startedAt: null })
  gate.resolve({ ready: true })

  assert.deepEqual(await pendingRestart, { acknowledged: false, active: false, startedAt: null })
  assert.equal(session.isActive(), false)
})

test('receipt saving aborts when stop wins during the preliminary gate probe', async () => {
  const { coordinator } = await activeCoordinator()
  const gate = deferred()
  let chose = false
  let wrote = false
  const saving = saveBoundFlightReceipt({
    coordinator,
    verifyGates: () => gate.promise,
    chooseDestination: async () => { chose = true; return '/private/receipt.json' },
    buildDocument: () => ({ status: 'passed' }),
    writeDocument: () => { wrote = true },
  })

  coordinator.stop()
  gate.resolve({ ready: true })
  assert.equal(await saving, null)
  assert.equal(chose, false)
  assert.equal(wrote, false)
})

test('receipt saving aborts when restart wins while the destination dialog is open', async () => {
  const { coordinator } = await activeCoordinator()
  const destination = deferred()
  const dialogOpened = deferred()
  let gateCalls = 0
  let wrote = false
  const saving = saveBoundFlightReceipt({
    coordinator,
    verifyGates: async () => { gateCalls += 1; return { ready: true } },
    chooseDestination: () => {
      dialogOpened.resolve()
      return destination.promise
    },
    buildDocument: () => ({ status: 'passed' }),
    writeDocument: () => { wrote = true },
  })

  await dialogOpened.promise
  const restarted = await coordinator.restart(async () => ({ ready: true }))
  assert.equal(restarted.acknowledged, true)
  destination.resolve('/private/receipt.json')
  assert.equal(await saving, null)
  assert.equal(gateCalls, 1)
  assert.equal(wrote, false)
})

test('receipt saving aborts when its session is invalidated during the final gate probe', async () => {
  const { coordinator } = await activeCoordinator()
  const finalGate = deferred()
  const finalGateStarted = deferred()
  let gateCalls = 0
  let wrote = false
  const saving = saveBoundFlightReceipt({
    coordinator,
    verifyGates: () => {
      gateCalls += 1
      if (gateCalls === 1) return Promise.resolve({ ready: true })
      finalGateStarted.resolve()
      return finalGate.promise
    },
    chooseDestination: async () => '/private/receipt.json',
    buildDocument: () => ({ status: 'passed' }),
    writeDocument: () => { wrote = true },
  })

  await finalGateStarted.promise
  coordinator.reset()
  finalGate.resolve({ ready: true })
  assert.equal(await saving, null)
  assert.equal(gateCalls, 2)
  assert.equal(wrote, false)
})

test('the final gate result, not preliminary evidence, determines the written receipt', async () => {
  const { coordinator } = await activeCoordinator()
  const admissions = [{ ready: true }, { ready: false, evidence: { usbDetected: false } }]
  let builtWith
  let written
  const result = await saveBoundFlightReceipt({
    coordinator,
    verifyGates: async () => admissions.shift(),
    chooseDestination: async () => '/private/receipt.json',
    buildDocument: ({ admission }) => {
      builtWith = admission
      return { status: admission.ready ? 'passed' : 'failed' }
    },
    writeDocument: (destination, document) => {
      written = { destination, document }
      return destination
    },
  })

  assert.deepEqual(builtWith, { ready: false, evidence: { usbDetected: false } })
  assert.deepEqual(written, {
    destination: '/private/receipt.json',
    document: { status: 'failed' },
  })
  assert.equal(result, '/private/receipt.json')
})
