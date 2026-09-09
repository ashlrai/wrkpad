const test = require('node:test')
const assert = require('node:assert/strict')
const { createApprovalStore } = require('./approval-store.cjs')

test('prunes expired approvals before reads and capacity decisions', () => {
  let now = 100
  const store = createApprovalStore({ now: () => now, maxEntries: 2 })
  assert.equal(store.set('a', { expires: 110 }), true)
  assert.equal(store.set('b', { expires: 120 }), true)
  assert.equal(store.set('c', { expires: 130 }), false)
  now = 111
  assert.equal(store.get('a'), undefined)
  assert.equal(store.set('c', { expires: 130 }), true)
  assert.equal(store.size(), 2)
})

test('consumes and explicitly revokes one exact token', () => {
  const store = createApprovalStore({ now: () => 100 })
  const approval = { expires: 120, webContentsId: 9 }
  assert.equal(store.set('token', approval), true)
  assert.equal(store.consume('token'), approval)
  assert.equal(store.consume('token'), undefined)
  assert.equal(store.set('other', approval), true)
  assert.equal(store.delete('other'), true)
  assert.equal(store.get('other'), undefined)
})

test('invalid clocks fail closed and invalid options are rejected', () => {
  const store = createApprovalStore({ now: () => Number.NaN })
  assert.equal(store.set('token', { expires: 120 }), false)
  assert.equal(store.get('token'), undefined)
  assert.throws(() => createApprovalStore({ maxEntries: 0 }), /invalid/)
})
