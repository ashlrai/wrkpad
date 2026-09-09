const test = require('node:test')
const assert = require('node:assert/strict')
const { createDisplayedMissionBinding } = require('./displayed-mission-binding.cjs')

test('physical actions retain the exact snapshot last published to each surface', () => {
  const binding = createDisplayedMissionBinding()
  const main = { agents: [{ slot: 1, title: 'Displayed target' }] }
  const backgroundRefresh = { agents: [{ slot: 1, title: 'Newer target' }] }
  const compact = { agents: [{ slot: 1, title: 'Compact target' }] }
  binding.publish('main', main)
  binding.publish('compact', compact)
  void backgroundRefresh
  assert.equal(binding.read('main'), main)
  assert.equal(binding.read('compact'), compact)
  binding.clear('main')
  assert.equal(binding.read('main'), null)
  assert.equal(binding.read('compact'), compact)
})

test('invalid surfaces and snapshots fail closed', () => {
  const binding = createDisplayedMissionBinding()
  assert.throws(() => binding.publish('unknown', { agents: [] }), /valid displayed mission/)
  assert.throws(() => binding.publish('main', {}), /valid displayed mission/)
  assert.equal(binding.read('unknown'), null)
})
