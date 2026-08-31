const test = require('node:test')
const assert = require('node:assert/strict')
const { HOLD_DURATION_MS, holdSatisfied } = require('./approval-guard.cjs')

test('hold requires an explicit continuous main-owned interval', () => {
  assert.equal(holdSatisfied({}, 5000), false)
  assert.equal(holdSatisfied({ holdStartedAt: 4000 }, 4000 + HOLD_DURATION_MS - 1), false)
  assert.equal(holdSatisfied({ holdStartedAt: 4000 }, 4000 + HOLD_DURATION_MS), true)
  assert.equal(holdSatisfied({ holdStartedAt: null }, 9000), false)
})
