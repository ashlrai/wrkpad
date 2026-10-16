const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateFlightGates } = require('./flight-gates.cjs')

const expectedSignals = ['dialLeft', 'dialRight']
const ready = {
  variant: 'daily',
  boardRoute: 'ashlr_layer',
  usbDetected: true,
  inputInstallation: { status: 'verified', version: '0.18.4' },
  inputProfile: { cacheStatus: 'available', activeProfile: 'Ashlr Agent Board Corrected', activeLayer: 'Ashlr Daily', encoderDirection: 'correct' },
  receiverRuntime: { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: 'a'.repeat(64) },
  shortcutRegistrations: expectedSignals.map((signalId) => ({ signalId, registered: true })),
  expectedSignals,
}

test('admits only a complete, current daily hardware gate set', () => {
  const result = evaluateFlightGates(ready)
  assert.equal(result.ready, true)
  assert.deepEqual(result.gates, { variant: true, route: true, usb: true, input: true, profile: true, receiver: true, shortcuts: true })
})

test('validates the diagnostic profile independently', () => {
  const result = evaluateFlightGates({
    ...ready,
    variant: 'diagnostic',
    inputProfile: { cacheStatus: 'available', activeProfile: 'Ashlr Flight Check Corrected - diagnostic', activeLayer: 'Ashlr Diagnostic', encoderDirection: 'correct' },
  })
  assert.equal(result.ready, true)
})

for (const [name, mutation, failedGate] of [
  ['unknown variant', { variant: 'other' }, 'variant'],
  ['undeclared route', { boardRoute: 'unknown' }, 'route'],
  ['missing USB', { usbDetected: false }, 'usb'],
  ['untrusted Input', { inputInstallation: { status: 'invalid_signature', version: '0.18.4' } }, 'input'],
  ['known Input resource mutation', { inputInstallation: { status: 'known_resource_mutation', version: '0.18.4' } }, 'input'],
  ['missing Input version', { inputInstallation: { status: 'verified', version: null } }, 'input'],
  ['wrong profile', { inputProfile: { ...ready.inputProfile, activeLayer: 'Other' } }, 'profile'],
  ['receiver contention', { receiverRuntime: { status: 'contended_distinct_builds', instanceCount: 2, distinctBuildCount: 2 } }, 'receiver'],
  ['partial shortcut registration', { shortcutRegistrations: [{ signalId: 'dialLeft', registered: true }] }, 'shortcuts'],
]) {
  test(`fails closed for ${name}`, () => {
    const result = evaluateFlightGates({ ...ready, ...mutation })
    assert.equal(result.ready, false)
    assert.equal(result.gates[failedGate], false)
  })
}

test('returns bounded evidence without local paths', () => {
  const result = evaluateFlightGates({
    ...ready,
    inputInstallation: { ...ready.inputInstallation, path: '/Users/private/Input.app' },
    receiverRuntime: { ...ready.receiverRuntime, executablePath: '/Users/private/Agent Board' },
  })
  assert.doesNotMatch(JSON.stringify(result.evidence), /Users|private|executablePath/)
})
