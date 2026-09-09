const test = require('node:test')
const assert = require('node:assert/strict')
const { createFlightSession } = require('./flight-session.cjs')

test('stopping a flight atomically clears its start and raw evidence', () => {
  const session = createFlightSession(() => '2026-08-31T18:00:00.000Z')
  session.start()
  assert.equal(session.record({ signalId: 'dialLeft' }), true)
  assert.deepEqual(session.snapshot(), {
    active: true,
    startedAt: '2026-08-31T18:00:00.000Z',
    invalidated: false,
    droppedEventCount: 0,
    droppedSuppressedDuplicateCount: 0,
    rawEvents: [{ signalId: 'dialLeft' }],
    suppressedDuplicateEvents: [],
  })
  assert.deepEqual(session.stop(), { active: false, startedAt: null, invalidated: false, droppedEventCount: 0, droppedSuppressedDuplicateCount: 0, rawEvents: [], suppressedDuplicateEvents: [] })
})

test('window-close reset cannot leave a hidden interlock or stale receipt', () => {
  const session = createFlightSession()
  session.start()
  session.record({ signalId: 'agent1' })
  session.reset()
  assert.equal(session.isActive(), false)
  assert.equal(session.record({ signalId: 'agent2' }), false)
  assert.deepEqual(session.snapshot(), { active: false, startedAt: null, invalidated: false, droppedEventCount: 0, droppedSuppressedDuplicateCount: 0, rawEvents: [], suppressedDuplicateEvents: [] })
})

test('restarting clears evidence without releasing the interlock', () => {
  const times = ['2026-08-31T18:00:00.000Z', '2026-08-31T18:01:00.000Z']
  const session = createFlightSession(() => times.shift())
  session.start()
  session.record({ signalId: 'joyUp' })

  assert.deepEqual(session.restart(), {
    active: true,
    startedAt: '2026-08-31T18:01:00.000Z',
    invalidated: false,
    droppedEventCount: 0,
    droppedSuppressedDuplicateCount: 0,
    rawEvents: [],
    suppressedDuplicateEvents: [],
  })
  assert.equal(session.isActive(), true)
})

test('retains bounded duplicate-suppression evidence and invalidates on overflow', () => {
  const session = createFlightSession(() => '2026-08-31T18:00:00.000Z')
  assert.equal(session.recordSuppressedDuplicate({ signalId: 'agent1' }), false)
  session.start()
  session.recordSuppressedDuplicate({ signalId: 'agent1', deltaNs: '1' })
  const first = session.snapshot()
  assert.deepEqual(first.suppressedDuplicateEvents, [{ signalId: 'agent1', deltaNs: '1' }])
  first.suppressedDuplicateEvents[0].signalId = 'changed'
  assert.equal(session.snapshot().suppressedDuplicateEvents[0].signalId, 'agent1')
  for (let index = 1; index < 103; index += 1) session.recordSuppressedDuplicate({ signalId: 'cmd1', deltaNs: String(index) })
  const overflow = session.snapshot()
  assert.equal(overflow.invalidated, true)
  assert.equal(overflow.droppedSuppressedDuplicateCount, 3)
  assert.equal(overflow.suppressedDuplicateEvents.length, 100)
  assert.equal(session.restart().suppressedDuplicateEvents.length, 0)
})

test('a failure latch and bounded overflow survive for the whole active run', () => {
  const session = createFlightSession(() => '2026-08-31T18:00:00.000Z')
  session.start()
  assert.equal(session.invalidate(), true)
  for (let index = 0; index < 503; index += 1) session.record({ signalId: 'dialLeft', sequence: index + 1 })
  const snapshot = session.snapshot()
  assert.equal(snapshot.invalidated, true)
  assert.equal(snapshot.droppedEventCount, 3)
  assert.equal(snapshot.rawEvents.length, 500)
  assert.equal(snapshot.rawEvents[0].sequence, 4)
  assert.equal(session.restart().invalidated, false)
  assert.equal(session.snapshot().droppedEventCount, 0)
})
