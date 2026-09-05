import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Ajv2020 from 'ajv/dist/2020.js'

import { buildPreflight } from '../../tools/agent-preflight.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const schema = JSON.parse(readFileSync(resolve(HERE, '..', '..', 'schemas', 'agent-preflight-v1.schema.json'), 'utf8'))
const ajv = new Ajv2020({
  allErrors: true,
  formats: {
    'date-time': (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)),
  },
})
const validate = ajv.compile(schema)

const source = {
  sha: 'a'.repeat(40),
  dirty: false,
  dirty_file_count: 0,
  inspection_limited_by_git_filters: false,
}

const appDoctorRaw = {
  schema: 'ai.ashlr.agent-board.doctor/v1',
  route: 'ashlr_layer',
  checks: [{ category: 'required', ok: true }],
  readiness: {
    codexNative: { status: 'blocked', reason: 'firmware_rpc_missing' },
    ashlrLayer: { status: 'manual', reason: 'physical_acceptance_required' },
  },
  inputProfile: { cacheStatus: 'available', dailyProfileMatch: true, dailyLayerMatch: true, encoderDirection: 'correct', dailyProfileReady: true },
  inputRuntime: { status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false },
}

test('agent preflight output conforms to its public schema for every route', () => {
  for (const route of ['ashlr_layer', 'codex_native', 'hybrid_native']) {
    const doctor = route === 'hybrid_native' ? {
      ...appDoctorRaw,
      route,
      checks: [
        { name: 'Creator Micro 2 USB', category: 'required', ok: true },
        { name: 'Work Louder Input', category: 'required', ok: true },
        { name: 'ChatGPT desktop', category: 'required', ok: true },
      ],
      inputInstallation: { status: 'verified', version: '0.18.4' },
      receiverRuntime: {
        status: 'exclusive', instanceCount: 1, distinctBuildCount: 1,
        currentAsarSha256: 'b'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null,
      },
      inputApplication: { status: 'not_running' },
      inputProfile: {
        cacheStatus: 'available', dailyProfileMatch: false, dailyLayerMatch: false,
        encoderDirection: 'unavailable', dailyProfileReady: false,
        hybridProfileMatch: true, hybridLayersMatch: true, hybridProfileReady: true,
      },
      readiness: {
        ...appDoctorRaw.readiness,
        hybridNative: { status: 'manual', reason: 'separate_physical_acceptance_required' },
      },
    } : appDoctorRaw
    const output = buildPreflight({
      route,
      source,
      stable: null,
      appDoctorRaw: doctor,
      runCommand: () => ({ ok: false, stdout: '', code: 1 }),
      observedAt: '2026-09-01T20:00:00.000Z',
    })
    assert.equal(validate(output), true, JSON.stringify(validate.errors, null, 2))
  }
})
