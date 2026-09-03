const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ASHLR_LAYER_SIGNAL_IDS,
  HYBRID_NATIVE_SIGNAL_IDS,
  routeOwnsShortcuts,
  shortcutSignalsForRoute,
} = require('./board-route-policy.cjs')

test('Hybrid Native owns exactly the fourteen non-Agent controls in Flight order', () => {
  assert.deepEqual(HYBRID_NATIVE_SIGNAL_IDS, [
    'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7',
    'joyUp', 'joyRight', 'joyDown', 'joyLeft',
    'dialLeft', 'dialRight', 'dialPress',
  ])
  assert.equal(HYBRID_NATIVE_SIGNAL_IDS.length, 14)
  assert.equal(HYBRID_NATIVE_SIGNAL_IDS.some((signal) => signal.startsWith('agent')), false)
})

test('route shortcut plans are explicit, immutable, and fail closed', () => {
  assert.equal(ASHLR_LAYER_SIGNAL_IDS.length, 20)
  assert.equal(routeOwnsShortcuts('ashlr_layer'), true)
  assert.equal(routeOwnsShortcuts('hybrid_native'), true)
  for (const route of ['unknown', 'codex_native', 'HYBRID_NATIVE', null, undefined]) {
    assert.equal(routeOwnsShortcuts(route), false)
    assert.deepEqual(shortcutSignalsForRoute(route), [])
  }
  const copy = shortcutSignalsForRoute('hybrid_native')
  copy.push('agent1')
  assert.deepEqual(shortcutSignalsForRoute('hybrid_native'), HYBRID_NATIVE_SIGNAL_IDS)
})
