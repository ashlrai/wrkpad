const test = require('node:test')
const assert = require('node:assert/strict')
const { evaluateFlightGates } = require('./flight-gates.cjs')
const { ASHLR_LAYER_SIGNAL_IDS, HYBRID_NATIVE_SIGNAL_IDS } = require('./board-route-policy.cjs')

const ready = {
  variant: 'daily',
  boardRoute: 'ashlr_layer',
  usbDetected: true,
  inputInstallation: { status: 'verified', version: '0.18.4' },
  inputProfile: { cacheStatus: 'available', activeProfile: 'Ashlr Agent Board Corrected', activeLayer: 'Ashlr Daily', encoderDirection: 'correct' },
  receiverRuntime: { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: 'a'.repeat(64) },
  shortcutRegistrations: ASHLR_LAYER_SIGNAL_IDS.map((signalId) => ({ signalId, registered: true })),
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

test('admits a verified Ashlr layer inside the current dual-plane profile without inventing an active layer', () => {
  const result = evaluateFlightGates({
    ...ready,
    dualPlaneAshlrLayerSelected: true,
    inputProfile: {
      cacheStatus: 'available',
      activeProfile: 'Ashlr Dual Plane (UNOFFICIAL)',
      activeLayer: null,
      encoderDirection: 'unavailable',
      configuredLayers: [
        { name: 'Codex Native Recovery (UNOFFICIAL)', mapping: 'codex_native', encoderDirection: 'unrecognized' },
        { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
      ],
    },
  })
  assert.equal(result.ready, true)
  assert.equal(result.evidence.inputProfile.activeLayer, null)
})

test('rejects a dual-plane profile whose Ashlr layer is changed or whose profile is not current', () => {
  const inputProfile = {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Dual Plane (UNOFFICIAL)',
    activeLayer: null,
    encoderDirection: 'unavailable',
    configuredLayers: [
      { name: 'Codex Native Recovery (UNOFFICIAL)', mapping: 'codex_native', encoderDirection: 'unrecognized' },
      { name: 'Ashlr Daily', mapping: 'unknown', encoderDirection: 'correct' },
    ],
  }
  assert.equal(evaluateFlightGates({ ...ready, dualPlaneAshlrLayerSelected: true, inputProfile }).gates.profile, false)
  assert.equal(evaluateFlightGates({ ...ready, dualPlaneAshlrLayerSelected: true, inputProfile: { ...inputProfile, activeProfile: 'Other' } }).gates.profile, false)
})

test('rejects a configured dual-plane profile without a fresh layer-2 operator attestation', () => {
  const inputProfile = {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Dual Plane (UNOFFICIAL)',
    activeLayer: null,
    encoderDirection: 'unavailable',
    configuredLayers: [
      { name: 'Codex Native Recovery (UNOFFICIAL)', mapping: 'codex_native', encoderDirection: 'unrecognized' },
      { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
    ],
  }
  assert.equal(evaluateFlightGates({ ...ready, inputProfile }).gates.profile, false)
})

test('Hybrid Native admits only the exact mixed profile, fourteen non-Agent shortcuts, and a quit Input app', () => {
  const result = evaluateFlightGates({
    ...ready,
    boardRoute: 'hybrid_native',
    inputApplication: { status: 'not_running' },
    inputProfile: {
      cacheStatus: 'available',
      activeProfile: 'Ashlr Hybrid Dual Plane (UNOFFICIAL)',
      activeLayer: null,
      encoderDirection: 'unavailable',
      configuredLayers: [
        { name: 'Ashlr Hybrid Native (UNOFFICIAL)', mapping: 'hybrid_native', encoderDirection: 'correct' },
        { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
      ],
    },
    shortcutRegistrations: HYBRID_NATIVE_SIGNAL_IDS.map((signalId) => ({ signalId, registered: true })),
  })
  assert.equal(result.ready, true)
  assert.equal(result.gates.inputApplication, true)
  assert.equal(result.evidence.shortcuts.expectedCount, 14)
  assert.equal(result.evidence.shortcuts.registeredCount, 14)
})

test('Hybrid Native fails closed for Input ownership, Agent-key capture, profile drift, and diagnostic aliasing', () => {
  const hybrid = {
    ...ready,
    boardRoute: 'hybrid_native',
    inputApplication: { status: 'not_running' },
    inputProfile: {
      cacheStatus: 'available', activeProfile: 'Ashlr Hybrid Dual Plane (UNOFFICIAL)', activeLayer: null, encoderDirection: 'unavailable',
      configuredLayers: [
        { name: 'Ashlr Hybrid Native (UNOFFICIAL)', mapping: 'hybrid_native', encoderDirection: 'correct' },
        { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
      ],
    },
    shortcutRegistrations: HYBRID_NATIVE_SIGNAL_IDS.map((signalId) => ({ signalId, registered: true })),
  }
  for (const mutation of [
    { inputApplication: { status: 'running' } },
    { inputApplication: { status: 'unavailable' } },
    { shortcutRegistrations: [...hybrid.shortcutRegistrations, { signalId: 'agent1', registered: true }] },
    { inputProfile: { ...hybrid.inputProfile, configuredLayers: [{ ...hybrid.inputProfile.configuredLayers[0], mapping: 'unknown' }, hybrid.inputProfile.configuredLayers[1]] } },
    { variant: 'diagnostic' },
  ]) assert.equal(evaluateFlightGates({ ...hybrid, ...mutation }).ready, false)
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
  ['extra shortcut registration', { shortcutRegistrations: [...ready.shortcutRegistrations, { signalId: 'extra', registered: true }] }, 'shortcuts'],
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
