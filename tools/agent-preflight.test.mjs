import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPreflight, gitEnvironment, resolveStableWrkpad, sourceSnapshot, stableWrkpadCandidates } from './agent-preflight.mjs'

const source = {
  sha: 'a'.repeat(40),
  dirty: false,
  dirty_file_count: 0,
  inspection_limited_by_git_filters: false,
}

const appDoctor = {
  schema: 'ai.ashlr.agent-board.doctor/v1',
  checks: [
    { category: 'required', ok: true },
    { category: 'required', ok: true },
  ],
  readiness: {
    codexNative: { status: 'blocked', reason: 'firmware_rpc_missing' },
    ashlrLayer: { status: 'manual', reason: 'physical_acceptance_required' },
  },
  inputProfile: {
    cacheStatus: 'available',
    dailyProfileMatch: true,
    dailyLayerMatch: true,
    encoderDirection: 'correct',
    dailyProfileReady: true,
  },
}

function commandFixture(_executable, args) {
  const joined = args.join(' ')
  if (joined === 'doctor --json') return json({ device_observer_ready: true, physical_conclusion: 'relevant_hid_present', hid_writes_enabled: false })
  if (joined === 'service status --json') return json({ installed: true, owned: true, loaded: true, healthy: true })
  if (joined.includes('hooks status --provider codex')) return json({ exact_handlers: 8, expected_handlers: 8, stale_or_duplicate_handlers: 0, unrelated_handlers: 1, trust: 'untrusted_or_unknown' })
  if (joined.includes('hooks status --provider claude')) return json({ exact_handlers: 14, expected_handlers: 14, stale_or_duplicate_handlers: 0, unrelated_handlers: 0, trust: 'untrusted_or_unknown' })
  if (joined === 'status --json') return json({ schema: 'dev.wrkpad.hasp.state/v1', revision: 7 })
  return { ok: false, stdout: '', code: 1 }
}

function json(value) { return { ok: true, stdout: JSON.stringify(value) } }

test('Codex Native remains blocked when the native firmware RPC is missing', () => {
  const result = buildPreflight({
    route: 'codex_native', source, appDoctorRaw: appDoctor,
    stable: { path: import.meta.filename, pathClass: 'stable_user_install' },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.schema, 'dev.wrkpad.agent-preflight/v1')
  assert.equal(result.requested_route, 'codex_native')
  assert.equal(result.declared_route, 'unknown')
  assert.equal(result.read_only, true)
  assert.equal(result.overall, 'blocked')
  assert.deepEqual(result.checks.find((item) => item.id === 'route_readiness'), {
    id: 'route_readiness', status: 'blocked', actor: 'human', safety: 'firmware',
    evidence: 'Codex Native: firmware_rpc_missing',
    reason: 'the current firmware lacks the mandatory native RPC; only a guarded vendor firmware qualification can change this state',
  })
  const firmwareStep = result.next_steps.find((item) => item.id === 'qualify_native_firmware')
  assert.equal(firmwareStep.command, undefined)
})

test('Ashlr Layer stays manual until physical acceptance', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, appDoctorRaw: appDoctor, stable: null,
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.overall, 'manual')
  assert.equal(result.binary.path_class, 'unavailable')
  assert.equal(result.checks.find((item) => item.id === 'route_readiness').actor, 'human')
  assert.ok(result.next_steps.some((item) => item.id === 'install_stable_binary'))
  assert.equal(result.checks.find((item) => item.id === 'input_profile').status, 'pass')
})

test('Ashlr Layer blocks the known reversed dial mapping', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputProfile: { ...appDoctor.inputProfile, dailyProfileReady: false, encoderDirection: 'reversed' },
      readiness: { ...appDoctor.readiness, ashlrLayer: { status: 'manual', reason: 'encoder_direction_reversed' } },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.overall, 'blocked')
  assert.equal(result.checks.find((item) => item.id === 'input_profile').reason, 'the read-only cache identifies the known reversed dial mapping')
})

test('preflight output never publishes executable firmware or permission steps', () => {
  for (const route of ['ashlr_layer', 'codex_native']) {
    const result = buildPreflight({
      route, source, appDoctorRaw: appDoctor, stable: null,
      developmentBinary: '/missing/development/binary', runCommand: commandFixture,
      observedAt: '2026-09-01T20:00:00.000Z',
    })
    for (const step of result.next_steps) {
      if (['permission', 'device_write', 'firmware', 'consequential'].includes(step.safety)) {
        assert.equal(step.command, undefined, step.id)
      }
    }
    assert.doesNotMatch(JSON.stringify(result), /\/Users\/|prompt|transcript|token/i)
  }
})

test('stable binary discovery never selects a build-tree executable', () => {
  const candidates = stableWrkpadCandidates('/home/example', 'linux')
  assert.equal(candidates.some((item) => item.path.includes('target/release')), false)
  assert.equal(resolveStableWrkpad({ candidates: [] }), null)
})

test('stable binary discovery ignores missing or non-executable candidates', () => {
  assert.equal(resolveStableWrkpad({
    platform: 'linux',
    candidates: [
      { path: '/missing/wrkpad', pathClass: 'stable_user_install' },
      { path: import.meta.filename, pathClass: 'stable_user_install' },
    ],
  }), null)
})

test('source identity disables external Git configuration and refuses status with local filters', () => {
  const calls = []
  const snapshot = sourceSnapshot((_executable, args, _cwd, options) => {
    calls.push({ args, env: options.env })
    if (args.includes('config')) return { ok: true, stdout: 'filter.hostile.process', code: 0 }
    if (args.includes('rev-parse')) return { ok: true, stdout: 'b'.repeat(40), code: 0 }
    if (args.includes('status')) return { ok: true, stdout: '', code: 0 }
    return { ok: false, stdout: '', code: 1 }
  })

  assert.equal(snapshot.sha, 'b'.repeat(40))
  assert.equal('branch' in snapshot, false)
  assert.equal(snapshot.dirty, null)
  assert.equal(snapshot.inspection_limited_by_git_filters, true)
  assert.equal(calls.some(({ args }) => args.includes('status')), false)
  assert.ok(calls.every(({ args }) => args.includes('core.fsmonitor=false')))
  assert.ok(calls.every(({ env }) => env.GIT_CONFIG_NOSYSTEM === '1' && env.GIT_CONFIG_GLOBAL))
})

test('Git environment removes inherited Git controls case-insensitively', () => {
  const environment = gitEnvironment({
    PATH: '/usr/bin',
    GIT_CONFIG_COUNT: '2',
    GIT_DIR: '/tmp/hostile',
    Git_Config_Key_0: 'core.fsmonitor',
  }, 'linux')
  assert.deepEqual(environment, {
    PATH: '/usr/bin',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
  })
})
