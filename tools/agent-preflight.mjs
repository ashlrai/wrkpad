#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { constants, accessSync, lstatSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..')
const APP_DOCTOR = join(REPO_ROOT, 'app', 'scripts', 'doctor.mjs')
const MAX_OUTPUT_BYTES = 256 * 1024
const ROUTES = new Set(['ashlr_layer', 'codex_native'])
const INPUT_RUNTIME_STATUSES = new Set(['unresolved_profile_layer', 'not_observed', 'log_missing', 'log_unsafe', 'log_unavailable'])
const boundedIsoTimestamp = (value) => {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null
}

function run(executable, args, cwd = REPO_ROOT, options = {}) {
  try {
    const stdout = execFileSync(executable, args, {
      cwd,
      env: options.env,
      encoding: 'utf8',
      timeout: 8_000,
      maxBuffer: MAX_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, stdout: stdout.trim() }
  } catch (error) {
    return {
      ok: false,
      stdout: typeof error?.stdout === 'string' ? error.stdout.slice(0, MAX_OUTPUT_BYTES).trim() : '',
      code: typeof error?.status === 'number' ? error.status : null,
    }
  }
}

function parseJson(result) {
  if (!result.ok) return null
  try { return JSON.parse(result.stdout) } catch { return null }
}

function sha256File(path) {
  if (!regularReadableFile(path)) return null
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return null
  }
}

function regularReadableFile(path, { executable = false, currentPlatform = platform() } = {}) {
  if (!path) return false
  try {
    const metadata = lstatSync(path)
    if (!metadata.isFile()) return false
    accessSync(path, constants.R_OK)
    return !executable || currentPlatform === 'win32' || (metadata.mode & 0o111) !== 0
  } catch {
    return false
  }
}

export function stableWrkpadCandidates(home = homedir(), currentPlatform = platform()) {
  if (currentPlatform === 'win32') {
    return [
      { path: join(home, '.local', 'bin', 'wrkpad.exe'), pathClass: 'stable_user_install' },
    ]
  }
  return [
    { path: join(home, '.local', 'bin', 'wrkpad'), pathClass: 'stable_user_install' },
    { path: '/opt/homebrew/bin/wrkpad', pathClass: 'stable_system_install' },
    { path: '/usr/local/bin/wrkpad', pathClass: 'stable_system_install' },
    { path: '/usr/bin/wrkpad', pathClass: 'stable_system_install' },
  ]
}

export function resolveStableWrkpad(options = {}) {
  const candidates = options.candidates ?? stableWrkpadCandidates(options.home, options.platform)
  const candidate = candidates.find((item) => regularReadableFile(item.path, {
    executable: true,
    currentPlatform: options.platform,
  }))
  return candidate ?? null
}

function gitExecutable() {
  return platform() === 'win32' ? 'git.exe' : '/usr/bin/git'
}

export function gitEnvironment(source = process.env, currentPlatform = platform()) {
  const env = {}
  for (const [key, value] of Object.entries(source)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value
  }
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = currentPlatform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

function hardenedGitArgs(args, currentPlatform = platform()) {
  return [
    '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${currentPlatform === 'win32' ? 'NUL' : '/dev/null'}`,
    '--no-pager',
    ...args,
  ]
}

export function sourceSnapshot(runCommand = run) {
  const git = gitExecutable()
  const environment = gitEnvironment()
  const execute = (args) => runCommand(git, hardenedGitArgs(args), REPO_ROOT, { env: environment })
  const shaResult = execute(['rev-parse', '--verify', 'HEAD'])
  const filterResult = execute(['config', '--local', '--null', '--name-only', '--get-regexp', '^[fF][iI][lL][tT][eE][rR]\\..*\\.(clean|smudge|process)$'])
  const configuredFilters = filterResult.ok && filterResult.stdout.length > 0
  const filterInspectionFailed = !filterResult.ok && filterResult.code !== 1
  const statusResult = configuredFilters || filterInspectionFailed
    ? { ok: false, stdout: '' }
    : execute(['status', '--porcelain=v1', '--untracked-files=normal'])
  const statusRows = statusResult.ok && statusResult.stdout
    ? statusResult.stdout.split('\n').filter(Boolean)
    : statusResult.ok ? [] : null
  return {
    sha: shaResult.ok && /^[0-9a-f]{40}$/.test(shaResult.stdout) ? shaResult.stdout : null,
    dirty: statusRows === null ? null : statusRows.length > 0,
    dirty_file_count: statusRows?.length ?? null,
    inspection_limited_by_git_filters: configuredFilters || filterInspectionFailed,
  }
}

function check(id, status, evidence, reason, actor = 'agent', safety = 'read') {
  return { id, status, actor, safety, evidence, reason }
}

function nextStep(id, actor, safety, requires, proves, doesNotProve, command) {
  return {
    id, actor, safety,
    ...(command ? { command } : {}),
    requires,
    proves,
    does_not_prove: doesNotProve,
  }
}

function projectAppDoctor(raw) {
  if (!raw || raw.schema !== 'ai.ashlr.agent-board.doctor/v1') return null
  const required = Array.isArray(raw.checks)
    ? raw.checks.filter((item) => item.category === 'required')
    : []
  const rawRuntime = raw.inputRuntime && typeof raw.inputRuntime === 'object' ? raw.inputRuntime : null
  const runtimeStatus = rawRuntime && INPUT_RUNTIME_STATUSES.has(rawRuntime.status) ? rawRuntime.status : rawRuntime ? 'invalid' : null
  const runtimeProfileIndex = Number.isInteger(rawRuntime?.profileIndex) && rawRuntime.profileIndex >= 0 && rawRuntime.profileIndex <= 31 ? rawRuntime.profileIndex : null
  const runtimeLayerIndex = Number.isInteger(rawRuntime?.layerIndex) && rawRuntime.layerIndex >= 0 && rawRuntime.layerIndex <= 15 ? rawRuntime.layerIndex : null
  const runtimeObservedAt = boundedIsoTimestamp(rawRuntime?.observedAt)
  const projectedRuntimeStatus = runtimeStatus === 'unresolved_profile_layer' && (runtimeProfileIndex === null || runtimeLayerIndex === null || runtimeObservedAt === null)
    ? 'invalid'
    : runtimeStatus
  return {
    declaredRoute: ['ashlr_layer', 'codex_native'].includes(raw.route) ? raw.route : 'unknown',
    inputProfile: raw.inputProfile && typeof raw.inputProfile === 'object' ? {
      cacheStatus: raw.inputProfile.cacheStatus ?? 'unknown',
      dailyProfileMatch: raw.inputProfile.dailyProfileMatch === true,
      dailyLayerMatch: raw.inputProfile.dailyLayerMatch === true,
      encoderDirection: raw.inputProfile.encoderDirection ?? 'unavailable',
      dailyProfileReady: raw.inputProfile.dailyProfileReady === true,
    } : null,
    inputRuntime: rawRuntime ? {
      status: projectedRuntimeStatus,
      profileIndex: runtimeProfileIndex,
      layerIndex: runtimeLayerIndex,
      observedAt: runtimeObservedAt,
      fresh: projectedRuntimeStatus === 'unresolved_profile_layer' && rawRuntime.fresh === true,
    } : null,
    requiredReady: required.length > 0 && required.every((item) => item.ok === true),
    nativeStatus: raw.readiness?.codexNative?.status ?? 'unknown',
    nativeReason: raw.readiness?.codexNative?.reason ?? 'native_readiness_unavailable',
    ashlrStatus: raw.readiness?.ashlrLayer?.status ?? 'manual',
    ashlrReason: raw.readiness?.ashlrLayer?.reason ?? 'physical_acceptance_required',
  }
}

function stableBinarySnapshot(stable, developmentBinary = join(REPO_ROOT, 'target', 'release', platform() === 'win32' ? 'wrkpad.exe' : 'wrkpad')) {
  const stableHash = sha256File(stable?.path)
  const developmentHash = sha256File(developmentBinary)
  return {
    available: Boolean(stable && stableHash),
    path_class: stable?.pathClass ?? 'unavailable',
    sha256: stableHash,
    development_binary_mismatch: Boolean(stableHash && developmentHash && stableHash !== developmentHash),
    local_build_available: Boolean(developmentHash),
    matches_local_build: Boolean(stableHash && developmentHash && stableHash === developmentHash),
  }
}

function runStableJson(stable, executionAuthorized, args, runCommand = run) {
  return stable && executionAuthorized ? parseJson(runCommand(stable.path, args)) : null
}

export function buildPreflight({
  route,
  observedAt = new Date().toISOString(),
  source = sourceSnapshot(),
  stable = resolveStableWrkpad(),
  runCommand = run,
  appDoctorRaw = parseJson(runCommand(process.execPath, [APP_DOCTOR, '--json'])),
  developmentBinary,
} = {}) {
  if (!ROUTES.has(route)) throw new Error(`route must be one of: ${[...ROUTES].join(', ')}`)

  const binary = stableBinarySnapshot(stable, developmentBinary)
  const appDoctor = projectAppDoctor(appDoctorRaw)
  const coreDoctor = runStableJson(stable, binary.matches_local_build, ['doctor', '--json'], runCommand)
  const service = runStableJson(stable, binary.matches_local_build, ['service', 'status', '--json'], runCommand)
  const codexHooks = runStableJson(stable, binary.matches_local_build, ['hooks', 'status', '--provider', 'codex', '--scope', 'user', '--json'], runCommand)
  const claudeHooks = runStableJson(stable, binary.matches_local_build, ['hooks', 'status', '--provider', 'claude', '--scope', 'user', '--json'], runCommand)
  const hasp = runStableJson(stable, binary.matches_local_build, ['status', '--json'], runCommand)

  const checks = [
    check(
      'source_identity',
      source.sha ? (source.dirty ? 'warn' : 'pass') : 'warn',
      source.sha ? `source SHA recorded; ${source.dirty_file_count ?? 'unknown'} dirty paths` : 'source SHA unavailable',
      source.dirty === true
        ? 'working tree changes must be reviewed before a release claim'
        : source.dirty === false ? 'source identity is suitable for local verification' : 'Git status is unavailable',
    ),
    check(
      'stable_wrkpad_binary',
      binary.matches_local_build ? 'pass' : 'warn',
      binary.available ? `${binary.path_class}; SHA-256 recorded; ${binary.matches_local_build ? 'byte-matches the current local release artifact' : 'execution refused pending a local byte match'}` : 'no stable installed wrkpad binary found',
      binary.development_binary_mismatch
        ? 'the build-tree binary differs; never use it to judge or mutate installed hook/service ownership'
        : binary.matches_local_build ? 'local byte equality permits bounded read-only checks but does not prove source identity, review, provenance, signing, or release' : binary.available ? 'an installed path alone is not trusted provenance and is never executed' : 'install explicitly before configuring hooks or the service',
    ),
    check(
      'route_declaration',
      appDoctor?.declaredRoute === route ? 'pass' : 'warn',
      `requested=${route}; declared=${appDoctor?.declaredRoute ?? 'unknown'}`,
      appDoctor?.declaredRoute === route
        ? 'the requested inspection route matches Agent Board local settings'
        : 'inspection intent does not match or cannot prove the current Agent Board route declaration',
    ),
    check(
      'agent_board_doctor',
      appDoctor?.requiredReady ? 'pass' : appDoctor ? 'blocked' : 'warn',
      appDoctor ? `required desktop probes ${appDoctor.requiredReady ? 'passed' : 'did not pass'}` : 'desktop doctor output unavailable or incompatible',
      appDoctor ? 'desktop USB and application prerequisites are projected separately from route readiness' : 'run the desktop doctor directly for bounded diagnostics',
    ),
    check(
      'core_device_observer',
      coreDoctor?.device_observer_ready === true ? 'pass' : coreDoctor ? 'warn' : 'warn',
      coreDoctor ? `physical conclusion: ${coreDoctor.physical_conclusion ?? 'unknown'}; HID writes: ${coreDoctor.hid_writes_enabled === true ? 'enabled' : 'disabled'}` : 'stable core doctor unavailable',
      'USB/HID presence does not prove firmware, ownership, lighting, or physical acceptance',
    ),
    check(
      'hasp_service',
      service?.installed && service?.owned && service?.loaded && service?.healthy ? 'pass' : service ? 'warn' : 'warn',
      service ? `installed=${Boolean(service.installed)}, owned=${Boolean(service.owned)}, loaded=${Boolean(service.loaded)}, healthy=${Boolean(service.healthy)}` : 'service status unavailable',
      'service health proves the local observer only, not provider invocation',
    ),
    check(
      'codex_hooks',
      codexHooks?.exact_handlers === codexHooks?.expected_handlers && codexHooks?.stale_or_duplicate_handlers === 0 ? 'pass' : codexHooks ? 'warn' : 'warn',
      codexHooks ? `${codexHooks.exact_handlers}/${codexHooks.expected_handlers} exact; ${codexHooks.unrelated_handlers ?? 0} unrelated; trust ${codexHooks.trust ?? 'unknown'}` : 'Codex hook status unavailable',
      'exact configuration does not prove Codex trust or a provider-fired event',
    ),
    check(
      'claude_hooks',
      claudeHooks?.exact_handlers === claudeHooks?.expected_handlers && claudeHooks?.stale_or_duplicate_handlers === 0 ? 'pass' : claudeHooks ? 'warn' : 'warn',
      claudeHooks ? `${claudeHooks.exact_handlers}/${claudeHooks.expected_handlers} exact; trust ${claudeHooks.trust ?? 'unknown'}` : 'Claude hook status unavailable',
      'exact configuration does not prove Claude Code invoked a hook',
    ),
    check(
      'hasp_snapshot',
      hasp?.schema === 'dev.wrkpad.hasp.state/v1' ? 'pass' : 'warn',
      hasp?.schema === 'dev.wrkpad.hasp.state/v1' ? `state revision ${hasp.revision ?? 'unknown'} observed` : 'authenticated HASP state unavailable',
      'a state receipt does not prove a fresh provider event or physical signal',
    ),
  ]

  if (route === 'ashlr_layer') {
    const profile = appDoctor?.inputProfile
    const runtime = appDoctor?.inputRuntime
    const runtimeUnavailable = ['log_missing', 'log_unsafe', 'log_unavailable', 'invalid'].includes(runtime?.status)
    checks.push(check(
      'input_profile',
      profile?.dailyProfileReady ? 'pass' : profile?.encoderDirection === 'reversed' ? 'blocked' : 'warn',
      profile ? `cache=${profile.cacheStatus}; daily_profile_match=${profile.dailyProfileMatch}; daily_layer_match=${profile.dailyLayerMatch}; encoder=${profile.encoderDirection}` : 'bounded Input profile evidence unavailable',
      profile?.dailyProfileReady
        ? 'the read-only cache matches the corrected daily profile; a board write and physical dial route are not yet proven'
        : profile?.encoderDirection === 'reversed' ? 'the read-only cache identifies the known reversed dial mapping' : 'activate the corrected daily profile in Work Louder Input before Flight Check',
    ))
    checks.push(check(
      'input_runtime',
      runtime?.status === 'unresolved_profile_layer' && runtime.fresh || runtimeUnavailable ? 'warn' : runtime ? 'pass' : 'warn',
      runtime?.status === 'unresolved_profile_layer'
        ? `reason=unresolved_profile_layer; profile_index=${runtime.profileIndex ?? 'unknown'}; layer_index=${runtime.layerIndex ?? 'unknown'}; fresh=${runtime.fresh}`
        : runtimeUnavailable ? `reason=${runtime.status}; bounded Input runtime evidence unavailable` : runtime ? `reason=${runtime.status}; no recent unresolved combination projected` : 'bounded Input runtime evidence unavailable',
      runtime?.status === 'unresolved_profile_layer' && runtime.fresh
        ? 'Input recently logged an unresolved index combination; it may predate the current cache and does not prove current device state'
        : runtimeUnavailable ? 'runtime evidence is unavailable or unsafe; do not infer an error-free Input session' : runtime ? 'no recent unresolved Input profile/layer event requires an advisory' : 'run the desktop doctor directly for bounded Input runtime evidence',
    ))
    checks.push(check(
      'route_readiness',
      appDoctor?.ashlrStatus === 'blocked' ? 'blocked' : 'manual',
      `Ashlr Layer: ${appDoctor?.ashlrReason ?? 'daily profile and Flight Check require verification'}`,
      'Input profile activation, macOS permission, and the physical Flight Check remain human acceptance gates',
      'human',
      'permission',
    ))
  } else {
    const firmwareMissing = appDoctor?.nativeStatus === 'blocked'
    checks.push(check(
      'route_readiness',
      firmwareMissing ? 'blocked' : 'manual',
      `Codex Native: ${appDoctor?.nativeReason ?? 'native connection requires manual verification'}`,
      firmwareMissing
        ? 'the current firmware lacks the mandatory native RPC; only a guarded vendor firmware qualification can change this state'
        : 'Codex Settings must show a native connection and physical controls must be accepted',
      firmwareMissing ? 'human' : 'human',
      firmwareMissing ? 'firmware' : 'device_write',
    ))
  }

  const nextSteps = [
    nextStep(
      'verify_repository_contract', 'agent', 'read', [],
      'the agent-preflight, DCO, and documentation helper tests pass',
      'full source formatting, application or Rust tests, builds, dependency policy, installation, provider invocation, physical acceptance, signing, or release',
      { executable: 'node', args: ['--test', 'tools/agent-preflight.test.mjs', 'tools/check-dco.test.mjs', 'tools/docs-check.test.mjs'], cwd: '$REPO_ROOT' },
    ),
  ]
  if (!binary.available) {
    nextSteps.push(nextStep(
      'install_stable_binary', 'human', 'local_write', ['review the exact source SHA and destination'],
      'a stable user-local wrkpad executable exists outside the build tree',
      'hook installation, service health, provider trust, or physical acceptance',
    ))
  } else if (!binary.matches_local_build) {
    nextSteps.push(nextStep(
      'build_local_comparison', 'agent', 'local_write', ['review the current checkout and Rust toolchain'],
      'a current local release artifact exists so the next preflight can compare bytes before executing the installed binary',
      'installed-binary provenance, source review, signing, provider invocation, or release',
      { executable: 'cargo', args: ['build', '--release', '--locked'], cwd: '$REPO_ROOT' },
    ))
  }
  nextSteps.push(route === 'ashlr_layer'
    ? nextStep(
      'complete_ashlr_flight_check', 'human', 'permission', ['active corrected Input profile', 'Input Monitoring granted', 'actions suppressed'],
      'the named daily shortcut route emitted all expected physical gestures',
      'native Codex RGB, firmware compatibility, provider authority, or consequential-action approval',
    )
    : nextStep(
      'qualify_native_firmware', 'human', 'firmware', ['vendor-matched stable image', 'recorded checksum', 'stable power', 'recovery plan', 'Codex, Agent Board, and competing HID controllers quit; signed Work Louder Input is sole owner'],
      'the exact firmware and Codex build complete rgbcfg then thstatus and physical acceptance',
      'cross-provider Ashlr Layer readiness or general hardware compatibility',
    ))

  const overall = checks.some((item) => item.status === 'blocked')
    ? 'blocked'
    : checks.some((item) => item.status === 'manual' || item.status === 'warn') ? 'manual' : 'ready'

  return {
    schema: 'dev.wrkpad.agent-preflight/v1',
    observed_at: observedAt,
    requested_route: route,
    declared_route: appDoctor?.declaredRoute ?? 'unknown',
    read_only: true,
    source,
    binary,
    checks,
    next_steps: nextSteps,
    overall,
  }
}

function parseCli(argv) {
  const [command = 'inspect', ...rest] = argv
  if (command !== 'inspect') throw new Error('only the read-only inspect command is available in v1')
  let route = 'ashlr_layer'
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] === '--route') route = rest[++index]
    else if (rest[index] !== '--json') throw new Error(`unknown argument: ${rest[index]}`)
  }
  if (!ROUTES.has(route)) throw new Error(`route must be one of: ${[...ROUTES].join(', ')}`)
  return { route }
}

function main() {
  try {
    const options = parseCli(process.argv.slice(2))
    console.log(JSON.stringify(buildPreflight(options), null, 2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'agent preflight failed')
    process.exitCode = 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
