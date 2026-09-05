const assert = require('node:assert/strict')
const test = require('node:test')
const { MAX_PUBLIC_FLIGHT_EVENTS, MAX_SIGNAL_IDS, MAX_TOTAL_OBSERVED, createShortcutObservability, projectFlightSnapshot } = require('./shortcut-observability.cjs')

test('records only bounded allowlisted callback metadata before an allow decision', () => {
  const telemetry = createShortcutObservability({
    signalIds: ['agent1', 'cmd1'],
    now: () => new Date('2026-09-04T05:00:00.000Z'),
  })

  const observation = telemetry.observe('agent1')
  assert.deepEqual(telemetry.snapshot(), {
    generation: 0,
    scope: 'unowned',
    totalObserved: 1,
    last: { signalId: 'agent1', receivedAt: '2026-09-04T05:00:00.000Z', outcome: 'rejected' },
  })
  assert.equal(telemetry.allow(observation), true)
  assert.deepEqual(telemetry.snapshot().last, {
    signalId: 'agent1', receivedAt: '2026-09-04T05:00:00.000Z', outcome: 'allowed',
  })
  assert.equal(telemetry.snapshot().keyText, undefined)
})

test('ignores unknown controls, refuses stale decisions, and returns defensive snapshots', () => {
  let tick = 0
  const telemetry = createShortcutObservability({
    signalIds: ['agent1', 'agent2'],
    now: () => new Date(1_800_000_000_000 + tick++),
  })
  assert.equal(telemetry.observe('private-key-text'), null)
  const first = telemetry.observe('agent1')
  const second = telemetry.observe('agent2')
  assert.equal(telemetry.allow(first), false)
  assert.equal(telemetry.allow(second), true)
  const snapshot = telemetry.snapshot()
  snapshot.last.outcome = 'rejected'
  assert.equal(telemetry.snapshot().last.outcome, 'allowed')
  assert.equal(telemetry.snapshot().totalObserved, 2)
})

test('fails closed for invalid construction and invalid clocks', () => {
  assert.throws(() => createShortcutObservability(), /bounded shortcut signal allowlist/)
  assert.throws(() => createShortcutObservability({ signalIds: Array.from({ length: MAX_SIGNAL_IDS + 1 }, (_, index) => `a${index}`) }), /bounded shortcut signal allowlist/)
  assert.throws(() => createShortcutObservability({ signalIds: ['agent1', 'agent1'] }), /bounded shortcut signal allowlist/)
  assert.throws(() => createShortcutObservability({ signalIds: ['agent1'], now: null }), /bounded shortcut signal allowlist/)
  const telemetry = createShortcutObservability({ signalIds: ['agent1'], now: () => 'invalid' })
  assert.equal(telemetry.observe('agent1'), null)
  assert.deepEqual(telemetry.snapshot(), { generation: 0, scope: 'unowned', totalObserved: 0, last: null })
  assert.equal(Number.isSafeInteger(MAX_TOTAL_OBSERVED), true)
})

test('ownership generations clear stale callback evidence and reject prior decisions', () => {
  const telemetry = createShortcutObservability({ signalIds: ['agent1'] })
  const stale = telemetry.observe('agent1')
  assert.equal(telemetry.beginGeneration('ashlr_layer'), true)
  assert.deepEqual(telemetry.snapshot(), { generation: 1, scope: 'ashlr_layer', totalObserved: 0, last: null })
  assert.equal(telemetry.allow(stale), false)
  assert.equal(telemetry.beginGeneration('ashlr_layer'), false)
  assert.equal(telemetry.beginGeneration('ashlr_layer', true), true)
  assert.equal(telemetry.snapshot().generation, 2)
  assert.equal(telemetry.beginGeneration('INVALID SCOPE'), false)
})

test('projects a bounded allowlisted authoritative Flight snapshot', () => {
  const event = (sequence, signalId = 'agent1', overrides = {}) => ({
    schemaVersion: 1,
    sequence,
    signalId,
    source: 'global-shortcut',
    accelerator: 'Control+Alt+Command+1',
    receivedAt: '2026-09-04T05:00:00.000Z',
    monotonicNs: String(sequence),
    ...overrides,
  })
  const projected = projectFlightSnapshot({
    active: true,
    startedAt: '2026-09-04T04:59:59.000Z',
    invalidated: true,
    droppedEventCount: 7,
    rawEvents: Array.from({ length: MAX_PUBLIC_FLIGHT_EVENTS + 3 }, (_, index) => event(index + 1)),
  }, { agent1: 'Control+Alt+Command+1' })
  assert.equal(projected.active, true)
  assert.equal(projected.startedAt, '2026-09-04T04:59:59.000Z')
  assert.equal(projected.invalidated, true)
  assert.equal(projected.droppedEventCount, 7)
  assert.equal(projected.rawEvents.length, MAX_PUBLIC_FLIGHT_EVENTS)
  assert.equal(projected.rawEvents[0].sequence, 4)
  assert.equal(projected.rawEvents.at(-1).sequence, MAX_PUBLIC_FLIGHT_EVENTS + 3)
})

test('drops malformed or non-allowlisted Flight events without leaking extra fields', () => {
  const valid = {
    schemaVersion: 1, sequence: 1, signalId: 'agent1', source: 'global-shortcut',
    accelerator: 'Control+Alt+Command+1', receivedAt: '2026-09-04T05:00:00.000Z', monotonicNs: '1',
    privateText: 'never project me',
  }
  const projected = projectFlightSnapshot({
    active: true,
    startedAt: 'invalid',
    rawEvents: [
      valid,
      { ...valid, sequence: 2, signalId: 'unknown' },
      { ...valid, sequence: 3, accelerator: 'changed' },
      { ...valid, sequence: 4, receivedAt: 'invalid' },
      { ...valid, sequence: 5, monotonicNs: '-1' },
    ],
  }, { agent1: 'Control+Alt+Command+1' })
  assert.deepEqual(projected, {
    active: true,
    startedAt: null,
    invalidated: false,
    droppedEventCount: 0,
    rawEvents: [{
      schemaVersion: 1, sequence: 1, signalId: 'agent1', source: 'global-shortcut',
      accelerator: 'Control+Alt+Command+1', receivedAt: '2026-09-04T05:00:00.000Z', monotonicNs: '1',
    }],
  })
})
