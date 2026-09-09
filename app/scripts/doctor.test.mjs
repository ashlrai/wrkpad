import assert from 'node:assert/strict'
import test from 'node:test'

import { detectCreatorMicro2, evaluateDoctor } from './doctor.mjs'

const receiverHash = 'a'.repeat(64)

const requiredProbes = {
  board: { ok: true, detail: 'Work Louder 303A:8298' },
  inputInstallation: { status: 'verified', version: '0.18.4' },
  receiverRuntime: {
    status: 'exclusive', instanceCount: 1, distinctBuildCount: 1,
    currentAsarSha256: receiverHash, candidateAsarSha256: null, candidateMatchesCurrent: null,
  },
  inputProfile: {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Agent Board Corrected',
    activeLayer: 'Ashlr Daily',
    encoderDirection: 'correct',
    configuredLayers: [
      { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
    ],
  },
  inputRuntime: {
    status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false,
    codexProtocolTraffic: { status: 'not_observed', observedAt: null, fresh: false },
  },
}

const missingOptionalProbes = {
  chatgpt: { ok: false, detail: 'missing' },
  codex: { ok: false, detail: 'unavailable' },
  nativeCodex: { ok: false, detail: 'not observed' },
  claude: { ok: false, detail: 'unavailable' },
  ashlr: { ok: false, detail: 'unavailable' },
  logitech: { ok: true, detail: 'not running' },
}

const hybridInputProfile = {
  cacheStatus: 'available',
  activeProfile: 'Ashlr Hybrid Dual Plane (UNOFFICIAL)',
  activeLayer: null,
  encoderDirection: 'unavailable',
  configuredLayers: [
    { name: 'Ashlr Hybrid Native (UNOFFICIAL)', mapping: 'hybrid_native', encoderDirection: 'correct' },
    { name: 'Ashlr Daily', mapping: 'ashlr_daily', encoderDirection: 'correct' },
  ],
}

test('recognizes both documented Creator Micro 2 identities without broad USB matching', () => {
  const usb = (vendor, product, productId) => `"USB Vendor Name" = "${vendor}"\n"USB Product Name" = "${product}"\n"idProduct" = ${productId}`
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 33432)).vidPid, '303A:8298')
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 33431)).vidPid, '303A:8297')
  assert.equal(detectCreatorMicro2(usb('Other Vendor', 'Creator Micro 2', 33432)), null)
  assert.equal(detectCreatorMicro2(usb('Work Louder', 'Creator Micro 2', 99999)), null)
})

test('missing optional integrations do not fail required doctor checks', () => {
  const result = evaluateDoctor(
    { ...requiredProbes, ...missingOptionalProbes },
    { observedAt: '2026-09-01T20:00:00.000Z' },
  )

  assert.equal(result.schema, 'ai.ashlr.agent-board.doctor/v1')
  assert.equal(result.observedAt, '2026-09-01T20:00:00.000Z')
  assert.equal(result.readOnly, true)
  assert.equal(result.route, 'unknown')
  assert.equal(result.inputProfile.dailyProfileReady, true)
  assert.equal('activeProfile' in result.inputProfile, false)
  assert.equal(result.ok, true)
  assert.equal(result.checks.filter((check) => check.category === 'required').every((check) => check.ok), true)
  assert.equal(
    result.checks
      .filter((check) => check.category === 'optional' && !check.ok)
      .every((check) => check.severity === 'warning' && !check.blocking),
    true,
  )
})

test('a missing board fails doctor and leads with USB recovery', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    board: { ok: false, detail: 'not detected' },
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks[0].severity, 'error')
  assert.match(result.nextAction, /data-capable USB-C cable/)
})

test('missing Work Louder Input fails doctor and leads with installation', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    inputInstallation: { status: 'missing', version: null },
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks[1].severity, 'error')
  assert.match(result.nextAction, /Install the signed Work Louder Input app/)
})

test('does not call a partial or silent-key Ashlr cache ready', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputProfile: {
      ...requiredProbes.inputProfile,
      configuredLayers: [{ name: 'Ashlr Daily', mapping: 'unknown', encoderDirection: 'correct', dailySignalCount: 19, unboundControls: ['ACT11'] }],
    },
  })

  assert.equal(result.inputProfile.dailyProfileReady, false)
  assert.equal(result.readiness.ashlrLayer.status, 'blocked')
  assert.equal(result.readiness.ashlrLayer.reason, 'active_profile_content_drift')
  assert.equal(result.inputProfile.dailySignalCount, 19)
  assert.deepEqual(result.inputProfile.unboundControls, ['ACT11'])
  assert.match(result.modeGuidance.ashlrLayer, /19\/20 expected bindings match; ACT11 is unbound/)
  assert.match(result.nextAction, /strictly verified 20-signal/)
  assert.match(result.nextAction, /Setting the same incomplete profile current is not a repair/)
})

test('required Input check passes only an exact verified installation receipt', () => {
  const verified = evaluateDoctor({ ...requiredProbes, ...missingOptionalProbes })
  assert.deepEqual(verified.inputInstallation, { status: 'verified', version: '0.18.4' })
  assert.equal(verified.checks[1].ok, true)
  assert.equal(verified.checks[1].code, 'verified')

  const invalid = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    input: { ok: true, detail: 'private false pass' },
    inputInstallation: { status: 'invalid_signature', version: '0.18.4', raw: '/Users/private/modified' },
  })
  assert.equal(invalid.ok, false)
  assert.deepEqual(invalid.inputInstallation, { status: 'invalid_signature', version: '0.18.4' })
  assert.deepEqual(invalid.checks[1], {
    name: 'Work Louder Input', ok: false, detail: 'Input.app signature integrity failed v0.18.4',
    category: 'required', severity: 'error', blocking: true, code: 'invalid_signature',
  })
  assert.match(invalid.nextAction, /replace or repair Input\.app from the signed vendor distribution/)
  assert.doesNotMatch(JSON.stringify(invalid), /private|Users|modified|false pass/)
})

test('known Input resource mutation stays blocked for the Ashlr Layer', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    chatgpt: { ok: true, detail: 'installed' },
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'RPC 404', fresh: true },
    inputInstallation: {
      status: 'known_resource_mutation', version: '0.18.4',
      resource: '/Users/private/window-info-retriever.scpt', raw: 'secret verification output',
    },
  })

  assert.equal(result.ok, false)
  assert.deepEqual(result.inputInstallation, { status: 'known_resource_mutation', version: '0.18.4' })
  assert.deepEqual(result.checks[1], {
    name: 'Work Louder Input', ok: false, detail: 'Input.app has the known modified signed resource v0.18.4',
    category: 'required', severity: 'error', blocking: true, code: 'known_resource_mutation',
  })
  assert.equal(result.readiness.prerequisites.status, 'blocked')
  assert.equal(result.readiness.ashlrLayer.status, 'blocked')
  assert.match(result.nextAction, /fully quit Input, preserve a stopped-state profile backup, replace it with one official signed vendor copy, then rerun the doctor/)
  assert.match(result.nextAction, /before reopening other board controllers/)
  assert.match(result.nextAction, /Do not repair or re-sign the app/)
  assert.doesNotMatch(JSON.stringify(result), /Users|private|secret|window-info-retriever/)
})

test('Codex Native treats Input integrity as advisory during a connection retry', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'codex_native',
    chatgpt: { ok: true, detail: 'installed' },
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'historical RPC 404', fresh: false },
    inputInstallation: {
      status: 'known_resource_mutation', version: '0.18.4',
      resource: '/Users/private/window-info-retriever.scpt', raw: 'secret verification output',
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.readiness.prerequisites.status, 'pass')
  assert.equal(result.readiness.codexNative.status, 'manual')
  assert.equal(result.readiness.codexNative.reason, 'historical_firmware_rpc_missing')
  assert.deepEqual(result.checks.find((check) => check.name === 'Work Louder Input'), {
    name: 'Work Louder Input', ok: false, detail: 'Input.app has the known modified signed resource v0.18.4',
    category: 'optional', severity: 'warning', blocking: false, code: 'known_resource_mutation',
  })
  assert.match(result.nextAction, /declare Ashlr Layer in Agent Board to register the 20 observed shortcut endpoints/)
  assert.match(result.modeGuidance.codexNative, /passive and registers zero endpoints/)
  assert.doesNotMatch(result.nextAction, /replace|repair|re-sign/)
  assert.doesNotMatch(JSON.stringify(result), /Users|private|secret|window-info-retriever/)
})

test('Codex Native requires verified Input only before a fresh firmware qualification', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'codex_native',
    chatgpt: { ok: true, detail: 'installed' },
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'RPC 404', fresh: true },
    inputInstallation: { status: 'invalid_signature', version: '0.18.4' },
    inputProfile: { cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable' },
  })

  assert.equal(result.ok, true)
  assert.equal(result.readiness.codexNative.reason, 'firmware_rpc_missing')
  assert.match(result.nextAction, /required before another firmware qualification/)
  assert.match(result.nextAction, /not before a read-only native connection retry/)
})

test('Codex Native requires USB and ChatGPT without promoting Input recovery', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'codex_native',
    inputInstallation: { status: 'invalid_signature', version: '0.18.4' },
  })

  assert.equal(result.ok, false)
  assert.equal(result.readiness.codexNative.status, 'blocked')
  assert.equal(result.readiness.codexNative.reason, 'native_prerequisite_missing')
  assert.match(result.nextAction, /Install ChatGPT desktop/)
  assert.doesNotMatch(result.nextAction, /replace|repair|re-sign/)
})

test('malformed Input installation evidence fails closed without leaking fields', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    inputInstallation: { status: '/Users/private', version: '0.18.4\nsecret', output: 'raw signature' },
  })
  assert.deepEqual(result.inputInstallation, { status: 'probe_unavailable', version: null })
  assert.equal(result.ok, false)
  assert.equal(result.checks[1].code, 'probe_unavailable')
  assert.doesNotMatch(JSON.stringify(result), /Users|secret|raw signature/)
})

test('Input installation versions must match the exact status shape', () => {
  for (const inputInstallation of [
    { status: 'verified', version: null },
    { status: 'known_resource_mutation', version: null },
    { status: 'known_resource_mutation', version: '0.18.5' },
    { status: 'missing', version: '0.18.4' },
    { status: 'probe_unavailable' },
  ]) {
    const result = evaluateDoctor({ ...requiredProbes, ...missingOptionalProbes, inputInstallation })
    assert.deepEqual(result.inputInstallation, { status: 'probe_unavailable', version: null })
    assert.equal(result.ok, false)
  }
})

test('receiver contention blocks only Ashlr readiness and requires a human single-receiver recovery', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    chatgpt: { ok: true, detail: 'installed' },
    receiverRuntime: {
      status: 'contended_distinct_builds', instanceCount: 2, distinctBuildCount: 2,
      currentAsarSha256: receiverHash, candidateAsarSha256: 'b'.repeat(64), candidateMatchesCurrent: false,
      processes: ['/Users/private/old', '/Users/private/new'],
    },
  })
  assert.equal(result.ok, true)
  assert.equal(result.readiness.ashlrLayer.status, 'blocked')
  assert.equal(result.readiness.ashlrLayer.reason, 'receiver_contended_distinct_builds')
  assert.notEqual(result.readiness.codexNative.status, 'blocked')
  assert.match(result.modeGuidance.ashlrLayer, /receiver ownership is contended/)
  assert.match(result.nextAction, /human must fully quit every Ashlr Agent Board copy/)
  assert.match(result.nextAction, /No process was quit automatically/)
  assert.doesNotMatch(JSON.stringify(result), /Users|private|old|new/)
})

test('unavailable or malformed receiver evidence blocks Ashlr and stays bounded', () => {
  for (const receiverRuntime of [
    { status: 'unavailable', instanceCount: 2, distinctBuildCount: 0, currentAsarSha256: null, candidateAsarSha256: null, candidateMatchesCurrent: null },
    { status: 'contended_same_build', instanceCount: 99_999, distinctBuildCount: 1, currentAsarSha256: '/private/hash', candidateAsarSha256: null, candidateMatchesCurrent: null, raw: 'secret' },
    { status: 'contended_distinct_builds', instanceCount: 2, distinctBuildCount: 3, currentAsarSha256: receiverHash, candidateAsarSha256: null, candidateMatchesCurrent: null },
    { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: receiverHash, candidateAsarSha256: 'b'.repeat(64), candidateMatchesCurrent: true },
  ]) {
    const result = evaluateDoctor({ ...requiredProbes, ...missingOptionalProbes, boardRoute: 'ashlr_layer', receiverRuntime })
    assert.deepEqual(result.receiverRuntime.status, 'unavailable')
    assert.equal(result.readiness.ashlrLayer.status, 'blocked')
    assert.equal(result.readiness.ashlrLayer.reason, 'receiver_probe_unavailable')
    assert.match(result.nextAction, /reopen exactly one reviewed build/)
    assert.doesNotMatch(JSON.stringify(result), /private|secret|99999/)
  }
})

test('native route guidance does not promote Ashlr receiver recovery over native qualification', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'codex_native',
    chatgpt: { ok: true, detail: 'installed' },
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'RPC 404', fresh: true },
    inputProfile: { cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable' },
    receiverRuntime: {
      status: 'contended_same_build', instanceCount: 2, distinctBuildCount: 1,
      currentAsarSha256: receiverHash, candidateAsarSha256: receiverHash, candidateMatchesCurrent: true,
    },
  })
  assert.equal(result.readiness.ashlrLayer.status, 'blocked')
  assert.equal(result.readiness.codexNative.reason, 'firmware_rpc_missing')
  assert.match(result.nextAction, /guarded vendor firmware qualification/)
  assert.doesNotMatch(result.nextAction, /reopen exactly one/)
})

test('result exposes non-blocking manual checks and a next action', () => {
  const result = evaluateDoctor({ ...requiredProbes, ...missingOptionalProbes })

  assert.equal(result.manualChecks.length, 3)
  assert.equal(result.manualChecks.every((check) => check.category === 'manual'), true)
  assert.equal(result.manualChecks.every((check) => check.status === 'manual' && !check.blocking), true)
  assert.match(result.nextAction, /Input Monitoring/)
})

test('Codex Native exposes its own ordered manual acceptance checks', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'codex_native',
    chatgpt: { ok: true, detail: 'installed' },
  })

  assert.deepEqual(result.manualChecks.map((check) => check.id), [
    'wired-mode',
    'native-owner-isolation',
    'native-settings',
    'native-physical-controls',
  ])
  assert.equal(result.manualChecks.every((check) => check.category === 'manual'), true)
  assert.equal(result.manualChecks.every((check) => check.status === 'manual' && !check.blocking), true)
  assert.doesNotMatch(JSON.stringify(result.manualChecks), /Input layer|Flight Check/)
})

test('Hybrid Native projects exact profile and quit-Input gates without claiming native acceptance', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'hybrid_native',
    chatgpt: { ok: true, detail: 'installed' },
    inputApplication: { status: 'not_running', privateProcess: '/Users/example/Input' },
    inputProfile: hybridInputProfile,
  })

  assert.equal(result.route, 'hybrid_native')
  assert.equal(result.ok, true)
  assert.deepEqual(result.inputApplication, { status: 'not_running' })
  assert.equal(result.inputProfile.hybridProfileMatch, true)
  assert.equal(result.inputProfile.hybridLayersMatch, true)
  assert.equal(result.inputProfile.hybridProfileReady, true)
  assert.deepEqual(result.readiness.hybridNative, {
    status: 'manual', reason: 'separate_physical_acceptance_required',
  })
  assert.deepEqual(result.manualChecks.map((check) => check.id), [
    'input-monitoring',
    'hybrid-layer',
    'hybrid-non-agent-flight-check',
    'hybrid-native-agent-acceptance',
  ])
  assert.match(result.manualChecks[2].detail, /cmd1, cmd2, cmd3, cmd4, cmd5, cmd6, cmd7, joyUp, joyRight, joyDown, joyLeft, dialLeft, dialRight, dialPress/)
  assert.match(result.manualChecks[2].detail, /does not test the six native Agent keys/)
  assert.match(result.manualChecks[3].detail, /Separately verify/)
  assert.doesNotMatch(JSON.stringify(result), /privateProcess|Users|firmware qualification|all native controls accepted/)
})

test('Hybrid Native fails closed when Input is running, unavailable, or profile evidence drifts', () => {
  for (const [overrides, reason, next] of [
    [{ inputApplication: { status: 'running', raw: '/Users/private' } }, 'input_application_running', /Fully quit Work Louder Input manually/],
    [{ inputApplication: { status: 'unavailable', raw: 'secret' } }, 'input_application_probe_unavailable', /confirm it is no longer running/],
    [{ inputProfile: { ...hybridInputProfile, configuredLayers: [...hybridInputProfile.configuredLayers].reverse() } }, 'hybrid_profile_requires_activation', /exact hybrid profile current with its hybrid layer first/],
    [{ inputProfile: { ...hybridInputProfile, activeProfile: 'Private forged profile' } }, 'hybrid_profile_requires_activation', /exact hybrid profile current/],
  ]) {
    const result = evaluateDoctor({
      ...requiredProbes,
      ...missingOptionalProbes,
      boardRoute: 'hybrid_native',
      chatgpt: { ok: true, detail: 'installed' },
      inputApplication: { status: 'not_running' },
      inputProfile: hybridInputProfile,
      ...overrides,
    })
    assert.equal(result.readiness.hybridNative.status, 'blocked')
    assert.equal(result.readiness.hybridNative.reason, reason)
    assert.match(result.nextAction, next)
    assert.doesNotMatch(JSON.stringify(result), /Users|private|secret|forged/)
  }
})

test('Hybrid Native requires USB, verified Input, and ChatGPT without promoting native firmware work', () => {
  for (const probes of [
    { board: { ok: false, detail: 'not detected' } },
    { inputInstallation: { status: 'invalid_signature', version: '0.18.4' } },
    { chatgpt: { ok: false, detail: 'missing' } },
  ]) {
    const result = evaluateDoctor({
      ...requiredProbes,
      ...missingOptionalProbes,
      boardRoute: 'hybrid_native',
      chatgpt: { ok: true, detail: 'installed' },
      inputApplication: { status: 'not_running' },
      inputProfile: hybridInputProfile,
      ...probes,
    })
    assert.equal(result.ok, false)
    assert.equal(result.readiness.hybridNative.status, 'blocked')
    assert.equal(result.readiness.hybridNative.reason, 'required_prerequisite_missing')
    assert.doesNotMatch(result.nextAction, /guarded vendor firmware qualification|prepare Agent Board’s passive Codex Native handoff|verify Settings → Creator Micro/i)
  }
})

test('available optional integrations are reported as passing', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    chatgpt: { ok: true, detail: 'installed' },
    codex: { ok: true, detail: 'codex 1.0' },
    nativeCodex: { ok: true, detail: 'connected', fresh: true },
    claude: { ok: true, detail: 'claude 1.0' },
    ashlr: { ok: true, detail: 'ashlr 1.0' },
    logitech: { ok: true, detail: 'not running' },
  })

  assert.equal(
    result.checks.filter((check) => check.category === 'optional').every((check) => check.severity === 'pass'),
    true,
  )
})

test('native firmware RPC failure receives specific nonblocking recovery guidance', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'codex_native',
    chatgpt: { ok: true, detail: 'installed' },
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'RPC 404', fresh: true },
    inputProfile: { cacheStatus: 'missing', activeProfile: null, activeLayer: null, encoderDirection: 'unavailable' },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.readiness.codexNative, {
    status: 'blocked',
    reason: 'firmware_rpc_missing',
    fresh: true,
  })
  assert.equal(result.readiness.ashlrLayer.status, 'manual')
  assert.equal(result.route, 'codex_native')
  assert.match(result.nextAction, /guarded vendor firmware qualification/)
  assert.match(result.modeGuidance.codexNative, /RPC 404/)
  assert.match(result.modeGuidance.ashlrLayer, /independently commissionable/)
})

test('Ashlr Layer never promotes an optional native firmware operation', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    chatgpt: { ok: true, detail: 'installed' },
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'historical RPC 404', fresh: false },
  })

  assert.match(result.nextAction, /Input Monitoring/)
  assert.match(result.modeGuidance.codexNative, /evidence is historical/)
  assert.match(result.modeGuidance.ashlrLayer, /independently commissionable/)
  assert.equal(result.route, 'ashlr_layer')
  assert.deepEqual(result.readiness.codexNative, {
    status: 'manual', reason: 'historical_firmware_rpc_missing', fresh: false,
  })
  assert.equal(result.readiness.ashlrLayer.status, 'manual')
})

test('doctor identifies the known reversed dial without exposing profile labels', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputProfile: {
      cacheStatus: 'available',
      activeProfile: 'Private operator profile',
      activeLayer: 'Private layer',
      encoderDirection: 'reversed',
    },
  })

  assert.equal(result.readiness.ashlrLayer.reason, 'encoder_direction_reversed')
  assert.deepEqual(result.inputProfile, {
    cacheStatus: 'available',
    dailyProfileMatch: false,
    dailyLayerMatch: false,
    encoderDirection: 'reversed',
    dailyProfileReady: false,
    dailySignalCount: null,
    unboundControls: [],
  })
})

test('doctor projects recent unresolved Input evidence without raw logs or a current-state claim', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputRuntime: {
      status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1,
      observedAt: '2026-09-01T19:33:00.000Z', fresh: true, raw: 'private log text',
    },
  })

  assert.deepEqual(result.inputRuntime, {
    status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1,
    observedAt: '2026-09-01T19:33:00.000Z', fresh: true,
    codexProtocolTraffic: { status: 'log_unavailable', observedAt: null, fresh: false },
  })
  assert.equal(result.readiness.ashlrLayer.reason, 'recent_unresolved_profile_layer_observed')
  assert.match(result.modeGuidance.ashlrLayer, /runtime layer index is offset from the cached layer ID/)
  assert.doesNotMatch(JSON.stringify(result), /private log text/)
})

test('doctor keeps vendor runtime layer indexes advisory while deterministic content drift blocks', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputProfile: {
      ...requiredProbes.inputProfile,
      configuredLayers: [{ name: 'Ashlr Daily', mapping: 'unknown', encoderDirection: 'correct', dailySignalCount: 19, unboundControls: ['ACT11'] }],
    },
    inputRuntime: {
      status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1,
      observedAt: '2026-09-01T19:33:00.000Z', fresh: true,
    },
  })

  assert.equal(result.inputProfile.dailyProfileReady, false)
  assert.equal(result.readiness.ashlrLayer.status, 'blocked')
  assert.equal(result.readiness.ashlrLayer.reason, 'active_profile_content_drift')
  assert.match(result.modeGuidance.ashlrLayer, /19\/20 expected bindings match/)
  assert.match(result.nextAction, /strictly verified 20-signal/)
  assert.match(result.nextAction, /same incomplete profile current is not a repair/)
  assert.match(result.nextAction, /Agent Board changed nothing/)
})

test('deterministic cache repair outranks advisory log evidence', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputProfile: { cacheStatus: 'available', activeProfile: 'Default', activeLayer: 'Layer 1', encoderDirection: 'reversed' },
    inputRuntime: { status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1, observedAt: '2026-09-01T19:33:00.000Z', fresh: true },
  })
  assert.equal(result.readiness.ashlrLayer.reason, 'encoder_direction_reversed')
  assert.match(result.nextAction, /Create and activate the corrected Input profile/)
})

test('doctor projects recurring Codex-protocol traffic as manual co-presence evidence', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputRuntime: {
      ...requiredProbes.inputRuntime,
      codexProtocolTraffic: {
        status: 'recurring_unresolved_response',
        observedAt: '2026-09-02T00:26:10.000Z',
        fresh: true,
        rpcId: 456,
        raw: 'private log text',
      },
    },
  })

  assert.deepEqual(result.inputRuntime.codexProtocolTraffic, {
    status: 'recurring_unresolved_response',
    observedAt: '2026-09-02T00:26:10.000Z',
    fresh: true,
  })
  assert.equal(result.readiness.ashlrLayer.status, 'manual')
  assert.equal(result.readiness.ashlrLayer.reason, 'recurring_codex_protocol_traffic')
  assert.match(result.modeGuidance.ashlrLayer, /co-presence evidence, not ownership/)
  assert.match(result.nextAction, /human must establish an Input-only window/)
  assert.equal(Object.hasOwn(result.inputRuntime.codexProtocolTraffic, 'rpcId'), false)
  assert.equal(Object.hasOwn(result.inputRuntime.codexProtocolTraffic, 'raw'), false)
  assert.doesNotMatch(JSON.stringify(result), /private log text/)
})

test('malformed recurring traffic cannot become a fresh advisory', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputRuntime: {
      ...requiredProbes.inputRuntime,
      codexProtocolTraffic: {
        status: 'recurring_unresolved_response',
        observedAt: 'private/path',
        fresh: true,
      },
    },
  })

  assert.deepEqual(result.inputRuntime.codexProtocolTraffic, {
    status: 'log_unavailable', observedAt: null, fresh: false,
  })
  assert.equal(result.readiness.ashlrLayer.reason, 'physical_acceptance_required')
  assert.doesNotMatch(JSON.stringify(result), /private\/path/)
})

test('malformed Input timestamps cannot become fresh advisories', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    boardRoute: 'ashlr_layer',
    inputRuntime: { status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1, observedAt: 'private/path', fresh: true },
  })
  assert.equal(result.inputRuntime.status, 'log_unavailable')
  assert.equal(result.inputRuntime.observedAt, null)
  assert.equal(result.inputRuntime.fresh, false)
  assert.equal(result.readiness.ashlrLayer.reason, 'physical_acceptance_required')
  assert.doesNotMatch(JSON.stringify(result), /private\/path/)
})

test('unknown Input runtime status fails closed', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    ...missingOptionalProbes,
    inputRuntime: { status: 'private/path', profileIndex: 2, layerIndex: 1, observedAt: '2026-09-01T19:33:00.000Z', fresh: true },
  })
  assert.deepEqual(result.inputRuntime, {
    status: 'log_unavailable', profileIndex: null, layerIndex: null, observedAt: null, fresh: false,
    codexProtocolTraffic: { status: 'log_unavailable', observedAt: null, fresh: false },
  })
  assert.doesNotMatch(JSON.stringify(result), /private\/path/)
})
