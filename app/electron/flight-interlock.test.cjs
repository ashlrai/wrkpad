const test = require('node:test')
const assert = require('node:assert/strict')
const { createFlightInterlock } = require('./flight-interlock.cjs')

test('flight interlock starts closed and only accepts an explicit true', () => {
  const interlock = createFlightInterlock()
  assert.equal(interlock.isActive(), false)
  assert.equal(interlock.set('true'), false)
  assert.equal(interlock.set(true), true)
  assert.equal(interlock.isActive(), true)
  assert.equal(interlock.set(false), false)
})
