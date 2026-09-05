const test = require('node:test')
const assert = require('node:assert/strict')
const { projectCommissioningSnapshot } = require('./commissioning-evidence.cjs')

const sha = (character) => character.repeat(64)
const status = {
  boardRoute: 'ashlr_layer',
  boardConnected: true,
  boardVidPid: '303A:8298',
  inputInstallation: { status: 'verified', version: '0.18.4' },
  inputApplication: { status: 'not_running' },
  inputProfile: { cacheStatus: 'available', inputCacheSha256: sha('a') },
  receiverRuntime: { status: 'exclusive', candidateMatchesCurrent: true },
  shortcutTelemetry: { totalObserved: 1, last: { outcome: 'allowed' } },
}
const candidate = { status: 'verified', sha256: sha('b') }

test('projects separate cache, receiver, candidate, and physical evidence', () => {
  const result = projectCommissioningSnapshot(status, candidate, '2026-09-04T18:00:00.000Z')
  assert.equal(result.device.status, 'exact')
  assert.equal(result.input.installation, 'trusted')
  assert.equal(result.input.cacheStatus, 'different')
  assert.equal(result.receiver.inputMonitoring, 'granted')
  assert.deepEqual(result.baseline, { status: 'missing', sha256: null })
  assert.deepEqual(result.physicalAcceptance, { status: 'pending', candidateSha256: null, acceptedAt: null })
})
test('USB identity and cache presence never imply permission, sync, or acceptance', () => {
  const result = projectCommissioningSnapshot({
    ...status,
    shortcutTelemetry: { totalObserved: 0, last: null },
  }, candidate, '2026-09-04T18:00:00.000Z')
  assert.equal(result.receiver.inputMonitoring, 'unknown')
  assert.equal(result.input.cacheStatus, 'different')
  assert.equal(result.physicalAcceptance.status, 'pending')
})

test('fails closed for undeclared and unsupported routes without leaking private fields', () => {
  assert.throws(() => projectCommissioningSnapshot({ ...status, boardRoute: 'unknown' }, candidate), /Ashlr Layer/)
  const result = projectCommissioningSnapshot({
    ...status,
    boardVidPid: '303A:8360',
    privatePath: '/private/device',
    serial: 'secret',
  }, candidate, '2026-09-04T18:00:00.000Z')
  assert.deepEqual(result.device, { status: 'unsupported', vidPid: '303A:8360' })
  assert.doesNotMatch(JSON.stringify(result), /private|secret/)
})
