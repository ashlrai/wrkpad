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
    { name: 'Creator Micro 2 USB', category: 'required', ok: true },
    { name: 'Work Louder Input', category: 'required', ok: true },
  ],
  inputInstallation: { status: 'verified', version: '0.18.4' },
  receiverRuntime: {
    status: 'exclusive', instanceCount: 1, distinctBuildCount: 1,
    currentAsarSha256: 'b'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null,
  },
  readiness: {
    codexNative: { status: 'blocked', reason: 'firmware_rpc_missing', fresh: true },
    ashlrLayer: { status: 'manual', reason: 'physical_acceptance_required' },
  },
  inputProfile: {
    cacheStatus: 'available',
    dailyProfileMatch: true,
    dailyLayerMatch: true,
    encoderDirection: 'correct',
    dailyProfileReady: true,
  },
  inputRuntime: {
    status: 'not_observed', profileIndex: null, layerIndex: null, observedAt: null, fresh: false,
    codexProtocolTraffic: { status: 'not_observed', observedAt: null, fresh: false },
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
    reason: 'a recent Codex receipt found the mandatory native RPC unavailable; only a guarded vendor firmware qualification can change that observed state',
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
  assert.ok(result.next_steps.some((item) => item.id === 'complete_ashlr_flight_check'))
  assert.equal(result.next_steps.some((item) => item.id === 'reconcile_input_profile'), false)
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
  assert.ok(result.next_steps.some((item) => item.id === 'reconcile_input_profile'))
  assert.equal(result.next_steps.some((item) => item.id === 'complete_ashlr_flight_check'), false)
})

test('Ashlr Layer blocks hostile Input integrity and never exposes raw diagnostic fields', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputInstallation: { status: 'invalid_signature', version: '0.18.4', path: '/Users/example/private', raw: 'secret' },
      checks: appDoctor.checks.map((item) => item.name === 'Work Louder Input' ? { ...item, ok: false } : item),
      readiness: { ...appDoctor.readiness, ashlrLayer: { status: 'blocked', reason: 'input_installation_unverified' } },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.checks.find((item) => item.id === 'input_installation_integrity').status, 'blocked')
  assert.ok(result.next_steps.some((item) => item.id === 'restore_signed_input'))
  assert.equal(result.next_steps.some((item) => item.id === 'reconcile_input_profile'), false)
  assert.doesNotMatch(JSON.stringify(result), /Users|private|secret/)
})

test('Codex Native restores signed Input before offering firmware qualification', () => {
  const result = buildPreflight({
    route: 'codex_native', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputInstallation: { status: 'invalid_signature', version: '0.18.4', raw: '/Users/example/private' },
      checks: appDoctor.checks.map((item) => item.name === 'Work Louder Input' ? { ...item, ok: false } : item),
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.checks.find((item) => item.id === 'input_installation_integrity').status, 'blocked')
  assert.ok(result.next_steps.some((item) => item.id === 'restore_signed_input'))
  assert.equal(result.next_steps.some((item) => item.id === 'qualify_native_firmware'), false)
  assert.doesNotMatch(JSON.stringify(result), /Users|private/)
})

test('historical native RPC evidence is advisory and requires a fresh native check', () => {
  const result = buildPreflight({
    route: 'codex_native', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      readiness: {
        ...appDoctor.readiness,
        codexNative: { status: 'manual', reason: 'historical_firmware_rpc_missing', fresh: false },
      },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.checks.find((item) => item.id === 'route_readiness').status, 'manual')
  assert.equal(result.checks.find((item) => item.id === 'route_readiness').safety, 'local_write')
  assert.match(result.checks.find((item) => item.id === 'route_readiness').reason, /historical/)
  assert.ok(result.next_steps.some((item) => item.id === 'verify_native_connection'))
  assert.equal(result.next_steps.some((item) => item.id === 'qualify_native_firmware'), false)
})

test('hostile Input versions and receiver shapes fail closed', () => {
  for (const hostile of [
    { inputInstallation: { status: 'verified', version: null } },
    { inputInstallation: { status: 'missing', version: '0.18.4' } },
    { receiverRuntime: { status: 'exclusive', instanceCount: 1, distinctBuildCount: 1, currentAsarSha256: 'b'.repeat(64), candidateAsarSha256: 'c'.repeat(64), candidateMatchesCurrent: true } },
    { receiverRuntime: { status: 'contended_distinct_builds', instanceCount: 2, distinctBuildCount: 3, currentAsarSha256: 'b'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null } },
  ]) {
    const result = buildPreflight({
      route: 'ashlr_layer', source, stable: null,
      appDoctorRaw: { ...appDoctor, ...hostile },
      developmentBinary: '/missing/development/binary', runCommand: commandFixture,
      observedAt: '2026-09-01T20:00:00.000Z',
    })
    if (hostile.inputInstallation) {
      assert.equal(result.checks.find((item) => item.id === 'input_installation_integrity').status, 'blocked')
    } else {
      assert.equal(result.checks.find((item) => item.id === 'receiver_ownership').evidence, 'status=unavailable; instances=0; builds=0')
    }
  }
})

test('agent preflight projects a valid blocked doctor receipt from its nonzero exit', () => {
  const blockedDoctor = {
    ...appDoctor,
    inputInstallation: { status: 'invalid_signature', version: '0.18.4' },
    checks: appDoctor.checks.map((item) => item.name === 'Work Louder Input' ? { ...item, ok: false } : item),
    readiness: { ...appDoctor.readiness, ashlrLayer: { status: 'blocked', reason: 'required_prerequisite_missing' } },
  }
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    developmentBinary: '/missing/development/binary',
    runCommand(executable, args) {
      if (executable === process.execPath && args.some((arg) => arg.endsWith('doctor.mjs'))) {
        return { ok: false, stdout: JSON.stringify(blockedDoctor), code: 1 }
      }
      return commandFixture(executable, args)
    },
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.checks.find((item) => item.id === 'agent_board_doctor').status, 'blocked')
  assert.equal(result.checks.find((item) => item.id === 'input_installation_integrity').evidence, 'status=invalid_signature; version=0.18.4')
  assert.ok(result.next_steps.some((item) => item.id === 'restore_signed_input'))
})

test('Ashlr Layer blocks multiple receiver builds before physical acceptance', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      receiverRuntime: {
        status: 'contended_distinct_builds', instanceCount: 2, distinctBuildCount: 2,
        currentAsarSha256: 'b'.repeat(64), candidateAsarSha256: null, candidateMatchesCurrent: null,
        privatePath: '/Users/example/private',
      },
      readiness: { ...appDoctor.readiness, ashlrLayer: { status: 'blocked', reason: 'receiver_contention' } },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.checks.find((item) => item.id === 'receiver_ownership').status, 'blocked')
  assert.ok(result.next_steps.some((item) => item.id === 'reconcile_agent_board_receivers'))
  assert.equal(result.next_steps.some((item) => item.id === 'complete_ashlr_flight_check'), false)
  assert.doesNotMatch(JSON.stringify(result), /Users|private/)
})

test('Ashlr Layer never recommends a device write when desktop prerequisites are missing', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      checks: [{ name: 'Creator Micro 2 USB', category: 'required', ok: false }],
      inputProfile: null,
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.ok(result.next_steps.some((item) => item.id === 'resolve_ashlr_prerequisites'))
  assert.equal(result.next_steps.some((item) => item.safety === 'device_write'), false)
  assert.equal(result.next_steps.some((item) => item.id === 'complete_ashlr_flight_check'), false)
})

test('Ashlr Layer rejects incomplete required checks and inconsistent hostile profile fields', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      checks: [{ name: 'Creator Micro 2 USB', category: 'required', ok: true }],
      inputProfile: {
        cacheStatus: 'available\nforged', dailyProfileMatch: true, dailyLayerMatch: true,
        encoderDirection: 'correct\nforged', dailyProfileReady: true,
      },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  assert.equal(result.checks.find((item) => item.id === 'agent_board_doctor').status, 'blocked')
  assert.equal(result.checks.find((item) => item.id === 'input_profile').evidence.includes('forged'), false)
  assert.ok(result.next_steps.some((item) => item.id === 'resolve_ashlr_prerequisites'))
  assert.equal(result.next_steps.some((item) => item.id === 'complete_ashlr_flight_check'), false)
  assert.equal(result.next_steps.some((item) => item.safety === 'device_write'), false)
})

test('Ashlr Layer exposes recent unresolved Input evidence as a bounded advisory', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputRuntime: { status: 'unresolved_profile_layer', profileIndex: 2, layerIndex: 1, observedAt: '2026-09-01T19:33:00.000Z', fresh: true },
      readiness: { ...appDoctor.readiness, ashlrLayer: { status: 'manual', reason: 'recent_unresolved_profile_layer_observed' } },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })

  const runtime = result.checks.find((item) => item.id === 'input_runtime')
  assert.equal(runtime.status, 'warn')
  assert.match(runtime.evidence, /profile_index=2; layer_index=1/)
  assert.match(runtime.reason, /may predate the current cache/)
})

test('Ashlr Layer warns when bounded Input runtime evidence is unsafe', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: { ...appDoctor, inputRuntime: { status: 'log_unsafe', profileIndex: null, layerIndex: null, observedAt: null, fresh: false } },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })
  const runtime = result.checks.find((item) => item.id === 'input_runtime')
  assert.equal(runtime.status, 'warn')
  assert.match(runtime.reason, /do not infer an error-free Input session/)
})

test('Ashlr Layer exposes recurring Codex-protocol traffic as a bounded warning', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputRuntime: {
        ...appDoctor.inputRuntime,
        codexProtocolTraffic: {
          status: 'recurring_unresolved_response',
          observedAt: '2026-09-02T00:26:10.000Z',
          fresh: true,
          rpcId: 456,
          raw: '/Users/example/private',
        },
      },
      readiness: { ...appDoctor.readiness, ashlrLayer: { status: 'manual', reason: 'recurring_codex_protocol_traffic' } },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-02T00:26:20.000Z',
  })

  const traffic = result.checks.find((item) => item.id === 'input_codex_protocol_traffic')
  assert.equal(traffic.status, 'warn')
  assert.equal(traffic.evidence, 'reason=recurring_unresolved_response; fresh=true')
  assert.match(traffic.reason, /co-presence evidence, not ownership/)
  assert.equal(result.checks.find((item) => item.id === 'route_readiness').status, 'manual')
  assert.ok(result.next_steps.some((item) => item.id === 'establish_input_only_recovery_window'))
  assert.equal(result.next_steps.some((item) => item.id === 'complete_ashlr_flight_check'), false)
  assert.equal(result.next_steps.some((item) => item.safety === 'device_write'), false)
  assert.doesNotMatch(JSON.stringify(result), /456|Users|private/)
})

test('malformed Codex-protocol traffic fails closed without leaking fields', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputRuntime: {
        ...appDoctor.inputRuntime,
        codexProtocolTraffic: {
          status: 'recurring_unresolved_response',
          observedAt: '/Users/example/private',
          fresh: true,
        },
      },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-02T00:26:20.000Z',
  })

  const traffic = result.checks.find((item) => item.id === 'input_codex_protocol_traffic')
  assert.equal(traffic.status, 'warn')
  assert.equal(traffic.evidence, 'reason=invalid; bounded Codex-protocol traffic evidence unavailable')
  assert.doesNotMatch(JSON.stringify(result), /Users|private/)
})

test('hostile Input runtime projection fails closed without exposing private fields', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputRuntime: { status: '/Users/example/private', profileIndex: 999, layerIndex: -1, observedAt: 'secret', fresh: true },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })
  const runtime = result.checks.find((item) => item.id === 'input_runtime')
  assert.equal(runtime.status, 'warn')
  assert.equal(runtime.evidence, 'reason=invalid; bounded Input runtime evidence unavailable')
  assert.doesNotMatch(JSON.stringify(result), /Users|private|secret|999/)
})

test('recognized unresolved status with malformed fields cannot pass', () => {
  const result = buildPreflight({
    route: 'ashlr_layer', source, stable: null,
    appDoctorRaw: {
      ...appDoctor,
      inputRuntime: { status: 'unresolved_profile_layer', profileIndex: 999, layerIndex: -1, observedAt: 'private/path', fresh: true },
    },
    developmentBinary: '/missing/development/binary', runCommand: commandFixture,
    observedAt: '2026-09-01T20:00:00.000Z',
  })
  const runtime = result.checks.find((item) => item.id === 'input_runtime')
  assert.equal(runtime.status, 'warn')
  assert.equal(runtime.evidence, 'reason=invalid; bounded Input runtime evidence unavailable')
  assert.doesNotMatch(JSON.stringify(result), /private\/path|999/)
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
