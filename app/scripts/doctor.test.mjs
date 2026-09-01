import assert from 'node:assert/strict'
import test from 'node:test'

import { detectCreatorMicro2, evaluateDoctor } from './doctor.mjs'

const requiredProbes = {
  board: { ok: true, detail: 'Work Louder 303A:8298' },
  input: { ok: true, detail: 'installed' },
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
  assert.deepEqual(detectCreatorMicro2('Work Louder ProductID = 33432'), { vidPid: '303A:8298', evidence: 'desk_verified' })
  assert.deepEqual(detectCreatorMicro2('Work Louder ProductID = 33431'), { vidPid: '303A:8297', evidence: 'candidate' })
  assert.equal(detectCreatorMicro2('Other Vendor ProductID = 33432'), null)
  assert.equal(detectCreatorMicro2('Work Louder ProductID = 99999'), null)
})

test('missing optional integrations do not fail required doctor checks', () => {
  const result = evaluateDoctor({ ...requiredProbes, ...missingOptionalProbes })

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
})
