const test = require('node:test')
const assert = require('node:assert/strict')
const { projectActiveFlightAcceptance, projectCommissioningSnapshot } = require('./commissioning-evidence.cjs')

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
  const result = projectCommissioningSnapshot(status, candidate, undefined, undefined, '2026-09-04T18:00:00.000Z')
  assert.equal(result.device.status, 'exact')
  assert.equal(result.input.installation, 'trusted')
  assert.equal(result.input.cacheStatus, 'different')
  assert.equal(result.receiver.inputMonitoring, 'unknown')
  assert.deepEqual(result.baseline, { status: 'missing', sha256: null })
  assert.deepEqual(result.physicalAcceptance, { status: 'pending', candidateSha256: null, acceptedAt: null })
})
test('USB identity and cache presence never imply permission, sync, or acceptance', () => {
  const result = projectCommissioningSnapshot({
    ...status,
    shortcutTelemetry: { totalObserved: 0, last: null },
  }, candidate, undefined, undefined, '2026-09-04T18:00:00.000Z')
  assert.equal(result.receiver.inputMonitoring, 'unknown')
  assert.equal(result.input.cacheStatus, 'different')
  assert.equal(result.physicalAcceptance.status, 'pending')
})

test('uses strict semantic cache evidence and preserves invalid cache state', () => {
  const exactProfile = {
    cacheStatus: 'available', inputCacheSha256: sha('c'), activeProfile: 'Ashlr Agent Board Corrected', activeLayer: 'Ashlr Daily', encoderDirection: 'correct',
    configuredLayers: [{ name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' }],
  }
  assert.equal(projectCommissioningSnapshot({ ...status, inputProfile: exactProfile }, candidate).input.cacheStatus, 'candidate')
  assert.equal(projectCommissioningSnapshot({ ...status, inputProfile: { cacheStatus: 'invalid', inputCacheSha256: null } }, candidate).input.cacheStatus, 'invalid')
})

test('accepts only an explicit candidate-bound physical result from the coordinator', () => {
  const acceptedAt = '2026-09-04T17:59:59.000Z'
  const result = projectCommissioningSnapshot(status, candidate, undefined, {
    status: 'accepted', candidateSha256: candidate.sha256, acceptedAt,
  }, '2026-09-04T18:00:00.000Z')
  assert.deepEqual(result.physicalAcceptance, { status: 'accepted', candidateSha256: candidate.sha256, acceptedAt })
})

test('acceptance exists only for the active candidate-bound Flight run', () => {
  const acceptedAt = '2026-09-04T17:59:59.000Z'
  const admission = { variant: 'daily', candidateSha256: candidate.sha256 }
  const flight = { active: true, invalidated: false, rawEvents: [{ signalId: 'cmd7', receivedAt: acceptedAt }] }
  const evaluation = { status: 'passed' }
  assert.deepEqual(projectActiveFlightAcceptance(admission, flight, evaluation, candidate), {
    status: 'accepted', candidateSha256: candidate.sha256, acceptedAt,
  })
  assert.equal(projectActiveFlightAcceptance(null, flight, evaluation, candidate).status, 'pending')
  assert.equal(projectActiveFlightAcceptance(admission, { ...flight, active: false }, evaluation, candidate).status, 'pending')
  assert.equal(projectActiveFlightAcceptance(admission, flight, evaluation, { ...candidate, sha256: sha('c') }).status, 'pending')
})

test('fails closed for undeclared and unsupported routes without leaking private fields', () => {
  assert.throws(() => projectCommissioningSnapshot({ ...status, boardRoute: 'unknown' }, candidate), /Ashlr Layer/)
  const result = projectCommissioningSnapshot({
    ...status,
    boardVidPid: '303A:8360',
    privatePath: '/private/device',
    serial: 'secret',
  }, candidate, undefined, undefined, '2026-09-04T18:00:00.000Z')
  assert.deepEqual(result.device, { status: 'unsupported', vidPid: '303A:8360' })
  assert.doesNotMatch(JSON.stringify(result), /private|secret/)
})
