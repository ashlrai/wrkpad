const test = require('node:test')
const assert = require('node:assert/strict')
const { hasFreshExactDualPlaneAshlrAttestation } = require('./dual-plane-attestation.cjs')

const now = Date.parse('2026-09-03T19:00:00.000Z')
const receipt = (attestedAt = new Date(now).toISOString()) => ({ dualPlaneAshlrLayerSelected: true, attestedAt })

test('accepts only the exact two-field receipt inside the freshness window', () => {
  assert.equal(hasFreshExactDualPlaneAshlrAttestation(receipt(), now), true)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation(receipt(new Date(now - 30_000).toISOString()), now), true)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation(receipt(new Date(now + 5_000).toISOString()), now), true)
})

test('rejects remembered, future, malformed, false, and extended receipts', () => {
  assert.equal(hasFreshExactDualPlaneAshlrAttestation(receipt(new Date(now - 30_001).toISOString()), now), false)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation(receipt(new Date(now + 5_001).toISOString()), now), false)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation({ ...receipt(), extra: true }, now), false)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation({ ...receipt(), dualPlaneAshlrLayerSelected: false }, now), false)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation({ dualPlaneAshlrLayerSelected: true, attestedAt: 'not-a-date' }, now), false)
  assert.equal(hasFreshExactDualPlaneAshlrAttestation(null, now), false)
})
