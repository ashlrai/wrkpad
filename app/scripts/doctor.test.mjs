import assert from 'node:assert/strict'
import test from 'node:test'

import { detectCreatorMicro2, evaluateDoctor } from './doctor.mjs'

const requiredProbes = {
  board: { ok: true, detail: 'Work Louder 303A:8298' },
  input: { ok: true, detail: 'installed' },
  inputProfile: {
    cacheStatus: 'available',
    activeProfile: 'Ashlr Agent Board Corrected',
    activeLayer: 'Ashlr Daily',
    encoderDirection: 'correct',
  },
  inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
}

const missingOptionalProbes = {
  chatgpt: { ok: false, detail: 'missing' },
  codex: { ok: false, detail: 'unavailable' },
  nativeCodex: { ok: false, detail: 'not observed' },
  claude: { ok: false, detail: 'unavailable' },
  ashlr: { ok: false, detail: 'unavailable' },
  logitech: { ok: true, detail: 'not running' },
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
    input: { ok: false, detail: 'missing' },
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks[1].severity, 'error')
  assert.match(result.nextAction, /Install the signed Work Louder Input app/)
})

test('result exposes non-blocking manual checks and a next action', () => {
  const result = evaluateDoctor({ ...requiredProbes, ...missingOptionalProbes })

  assert.equal(result.manualChecks.length, 3)
  assert.equal(result.manualChecks.every((check) => check.category === 'manual'), true)
  assert.equal(result.manualChecks.every((check) => check.status === 'manual' && !check.blocking), true)
  assert.match(result.nextAction, /Input Monitoring/)
})

test('available optional integrations are reported as passing', () => {
  const result = evaluateDoctor({
    ...requiredProbes,
    chatgpt: { ok: true, detail: 'installed' },
    codex: { ok: true, detail: 'codex 1.0' },
    nativeCodex: { ok: true, detail: 'connected' },
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
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'RPC 404' },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.readiness.codexNative, {
    status: 'blocked',
    reason: 'firmware_rpc_missing',
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
    nativeCodex: { ok: false, code: 'firmware_rpc_missing', detail: 'historical RPC 404' },
  })

  assert.match(result.nextAction, /Input Monitoring/)
  assert.match(result.modeGuidance.codexNative, /firmware candidate/)
  assert.match(result.modeGuidance.ashlrLayer, /independently commissionable/)
  assert.equal(result.route, 'ashlr_layer')
  assert.equal(result.readiness.codexNative.status, 'blocked')
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
  })
  assert.equal(result.readiness.ashlrLayer.reason, 'recent_unresolved_profile_layer_observed')
  assert.match(result.modeGuidance.ashlrLayer, /may predate the current cache/)
  assert.doesNotMatch(JSON.stringify(result), /private log text/)
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
  assert.deepEqual(result.inputRuntime, { status: 'log_unavailable', profileIndex: null, layerIndex: null, observedAt: null, fresh: false })
  assert.doesNotMatch(JSON.stringify(result), /private\/path/)
})
