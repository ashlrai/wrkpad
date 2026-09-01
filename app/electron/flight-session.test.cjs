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
    rawEvents: [{ signalId: 'dialLeft' }],
  })
  assert.deepEqual(session.stop(), { active: false, startedAt: null, rawEvents: [] })
})

test('window-close reset cannot leave a hidden interlock or stale receipt', () => {
  const session = createFlightSession()
  session.start()
  session.record({ signalId: 'agent1' })
  session.reset()
  assert.equal(session.isActive(), false)
  assert.equal(session.record({ signalId: 'agent2' }), false)
  assert.deepEqual(session.snapshot(), { active: false, startedAt: null, rawEvents: [] })
})

test('restarting clears evidence without releasing the interlock', () => {
  const times = ['2026-08-31T18:00:00.000Z', '2026-08-31T18:01:00.000Z']
  const session = createFlightSession(() => times.shift())
  session.start()
  session.record({ signalId: 'joyUp' })

  assert.deepEqual(session.restart(), {
    active: true,
    startedAt: '2026-08-31T18:01:00.000Z',
    rawEvents: [],
  })
  assert.equal(session.isActive(), true)
})
