const assert = require('node:assert/strict')
const test = require('node:test')
const {
  EDGE_DUPLICATE_WINDOW_NS,
  EDGE_SIGNAL_IDS,
  createShortcutEdgeDuplicateFilter,
} = require('./shortcut-edge-filter.cjs')

const callback = (overrides = {}) => ({
  signalId: 'agent1',
  accelerator: 'Control+Alt+Command+1',
  route: 'ashlr_layer',
  generation: 4,
  ...overrides,
})

function timedFilter(initialNs = 0n) {
  let nowNs = initialNs
  return {
    advance(ns) { nowNs += ns },
    set(ns) { nowNs = ns },
    filter: createShortcutEdgeDuplicateFilter({ clock: () => nowNs }),
  }
}

test('limits filtering to the fourteen buttons that produce discrete edges', () => {
  assert.deepEqual(EDGE_SIGNAL_IDS, [
    'agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6',
    'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7',
    'dialPress',
  ])

  for (const signalId of ['dialLeft', 'dialRight', 'joyUp', 'joyRight', 'joyDown', 'joyLeft']) {
    const timer = timedFilter()
    assert.equal(timer.filter.shouldSuppress(callback({ signalId })), false)
    timer.advance(1n)
    assert.equal(timer.filter.shouldSuppress(callback({ signalId })), false)
  }
})

test('suppresses one adjacent matching edge inside the inclusive 35ms window', () => {
  for (const signalId of EDGE_SIGNAL_IDS) {
    const timer = timedFilter()
    assert.equal(timer.filter.shouldSuppress(callback({ signalId })), false)
    timer.advance(EDGE_DUPLICATE_WINDOW_NS)
    assert.equal(timer.filter.shouldSuppress(callback({ signalId })), true)
  }

  // Additional callbacks fail open rather than hiding a noisy or repeated press.
  const timer = timedFilter()
  assert.equal(timer.filter.shouldSuppress(callback()), false)
  timer.advance(30_000_000n)
  assert.equal(timer.filter.shouldSuppress(callback()), true)
  timer.advance(1_000_000n)
  assert.equal(timer.filter.shouldSuppress(callback()), false)
  timer.advance(1_000_000n)
  assert.equal(timer.filter.shouldSuppress(callback()), false)
})

test('exposes bounded monotonic timing evidence for an adjacent duplicate', () => {
  const timer = timedFilter(10n)
  assert.deepEqual(timer.filter.inspect(callback()), { suppress: false, observedAtNs: 10n, deltaNs: null })
  timer.advance(12n)
  assert.deepEqual(timer.filter.inspect(callback()), { suppress: true, observedAtNs: 22n, deltaNs: 12n })
})

test('uses a non-sliding deadline anchored to the delivered edge', () => {
  const timer = timedFilter()
  assert.equal(timer.filter.shouldSuppress(callback()), false)
  timer.advance(34_000_000n)
  assert.equal(timer.filter.shouldSuppress(callback()), true)
  timer.advance(2_000_000n)
  assert.equal(timer.filter.shouldSuppress(callback()), false)

  // The callback outside the old window begins a new physical-edge window.
  timer.advance(1n)
  assert.equal(timer.filter.shouldSuppress(callback()), true)
})

test('requires exact signal, accelerator, route, and generation identity', () => {
  for (const changed of [
    { signalId: 'agent2' },
    { accelerator: 'Control+Alt+Command+2' },
    { route: 'hybrid_native' },
    { generation: 5 },
  ]) {
    const timer = timedFilter()
    assert.equal(timer.filter.shouldSuppress(callback()), false)
    timer.advance(1n)
    assert.equal(timer.filter.shouldSuppress(callback(changed)), false)
    timer.advance(1n)
    assert.equal(timer.filter.shouldSuppress(callback()), false)
  }
})

test('an intervening callback breaks duplicate adjacency', () => {
  const timer = timedFilter()
  assert.equal(timer.filter.shouldSuppress(callback()), false)
  timer.advance(1n)
  assert.equal(timer.filter.shouldSuppress(callback({ signalId: 'joyUp' })), false)
  timer.advance(1n)
  assert.equal(timer.filter.shouldSuppress(callback()), false)
  timer.advance(1n)
  assert.equal(timer.filter.shouldSuppress(callback()), true)
})

test('invalid or regressing monotonic clocks deliver and reset stale state', () => {
  let nowNs = 100n
  const filter = createShortcutEdgeDuplicateFilter({ clock: () => nowNs })
  assert.equal(filter.shouldSuppress(callback()), false)

  nowNs = 99n
  assert.equal(filter.shouldSuppress(callback()), false)
  nowNs = 100n
  assert.equal(filter.shouldSuppress(callback()), true)

  const invalid = createShortcutEdgeDuplicateFilter({ clock: () => 1 })
  assert.equal(invalid.shouldSuppress(callback()), false)
  assert.equal(invalid.shouldSuppress(callback()), false)

  const throwing = createShortcutEdgeDuplicateFilter({ clock: () => { throw new Error('clock failed') } })
  assert.equal(throwing.shouldSuppress(callback()), false)
  assert.equal(throwing.shouldSuppress(callback()), false)
})

test('malformed callbacks deliver and reset adjacency', () => {
  for (const malformed of [
    null,
    callback({ accelerator: '' }),
    callback({ route: '' }),
    callback({ generation: -1 }),
    callback({ generation: Number.MAX_SAFE_INTEGER + 1 }),
  ]) {
    const timer = timedFilter()
    assert.equal(timer.filter.shouldSuppress(callback()), false)
    timer.advance(1n)
    assert.equal(timer.filter.shouldSuppress(malformed), false)
    timer.advance(1n)
    assert.equal(timer.filter.shouldSuppress(callback()), false)
  }
})

test('reset prevents a callback from matching a prior physical edge', () => {
  const timer = timedFilter()
  assert.equal(timer.filter.shouldSuppress(callback()), false)
  timer.filter.reset()
  timer.advance(1n)
  assert.equal(timer.filter.shouldSuppress(callback()), false)
})

test('rejects unsafe construction options', () => {
  assert.throws(() => createShortcutEdgeDuplicateFilter({ clock: null }), /monotonic nanosecond clock/)
  assert.throws(() => createShortcutEdgeDuplicateFilter({ windowNs: 35 }), /monotonic nanosecond clock/)
  assert.throws(() => createShortcutEdgeDuplicateFilter({ windowNs: -1n }), /monotonic nanosecond clock/)
})
