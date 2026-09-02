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
const CODEX_PROTOCOL_TRAFFIC_STATUSES = new Set(['recurring_unresolved_response', 'not_observed', 'log_missing', 'log_unsafe', 'log_unavailable'])
const ASHLR_REQUIRED_DOCTOR_CHECK_NAMES = new Set(['Creator Micro 2 USB', 'Work Louder Input'])
const NATIVE_REQUIRED_DOCTOR_CHECK_NAMES = new Set(['Creator Micro 2 USB', 'ChatGPT desktop'])
const INPUT_CACHE_STATUSES = new Set(['available', 'missing', 'invalid', 'unsafe'])
const INPUT_ENCODER_DIRECTIONS = new Set(['correct', 'reversed', 'unrecognized', 'unavailable'])
const INPUT_INSTALLATION_STATUSES = new Set(['verified', 'missing', 'multiple_installations', 'unsafe', 'invalid_metadata', 'publisher_unrecognized', 'invalid_signature', 'known_resource_mutation', 'gatekeeper_rejected', 'probe_unavailable'])
const RECEIVER_RUNTIME_STATUSES = new Set(['not_running', 'exclusive', 'contended_same_build', 'contended_distinct_builds', 'unavailable'])
const READINESS_STATUSES = new Set(['pass', 'manual', 'blocked'])
const NATIVE_REASONS = new Set(['native_prerequisite_missing', 'firmware_rpc_missing', 'historical_firmware_rpc_missing', 'recent_native_connection_observed', 'native_connection_requires_verification'])
const ASHLR_REASONS = new Set(['required_prerequisite_missing', 'receiver_contended_same_build', 'receiver_contended_distinct_builds', 'receiver_probe_unavailable', 'receiver_not_running', 'encoder_direction_reversed', 'input_profile_requires_activation', 'recent_unresolved_profile_layer_observed', 'recurring_codex_protocol_traffic', 'physical_acceptance_required'])
const boundedHash = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null
const boundedVersion = (value) => typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(value) ? value : null
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

function parseJson(result, { allowNonZero = false } = {}) {
  if (!result || (!result.ok && !allowNonZero) || typeof result.stdout !== 'string') return null
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
  const checks = Array.isArray(raw.checks) ? raw.checks : []
  const required = checks.filter((item) => item.category === 'required')
  const requiredNames = new Set(required.map((item) => item?.name).filter((name) => typeof name === 'string'))
  const uniqueCheckReady = (name) => {
    const matches = checks.filter((item) => item?.name === name)
    return matches.length === 1 && matches[0].ok === true
  }
  const declaredRoute = ['ashlr_layer', 'codex_native'].includes(raw.route) ? raw.route : 'unknown'
  const rawInputInstallation = raw.inputInstallation && typeof raw.inputInstallation === 'object' ? raw.inputInstallation : null
  const projectedInputStatus = INPUT_INSTALLATION_STATUSES.has(rawInputInstallation?.status) ? rawInputInstallation.status : 'probe_unavailable'
  const inputVersion = boundedVersion(rawInputInstallation?.version)
  const inputVersionRequired = ['verified', 'publisher_unrecognized', 'invalid_signature', 'known_resource_mutation', 'gatekeeper_rejected'].includes(projectedInputStatus)
  const inputVersionForbidden = ['missing', 'multiple_installations', 'unsafe', 'invalid_metadata', 'probe_unavailable'].includes(projectedInputStatus)
  const knownMutationVersionInvalid = projectedInputStatus === 'known_resource_mutation' && inputVersion !== '0.18.4'
  const inputShapeValid = !(inputVersionRequired && inputVersion === null)
    && !(inputVersionForbidden && rawInputInstallation?.version !== null)
    && !knownMutationVersionInvalid
  const inputInstallation = {
    status: inputShapeValid ? projectedInputStatus : 'probe_unavailable',
    version: inputShapeValid ? inputVersion : null,
  }
  const rawReceiverRuntime = raw.receiverRuntime && typeof raw.receiverRuntime === 'object' ? raw.receiverRuntime : null
  const receiverStatus = RECEIVER_RUNTIME_STATUSES.has(rawReceiverRuntime?.status) ? rawReceiverRuntime.status : 'unavailable'
  const receiverInstanceCount = Number.isInteger(rawReceiverRuntime?.instanceCount) && rawReceiverRuntime.instanceCount >= 0 && rawReceiverRuntime.instanceCount <= 64 ? rawReceiverRuntime.instanceCount : 0
  const receiverBuildCount = Number.isInteger(rawReceiverRuntime?.distinctBuildCount) && rawReceiverRuntime.distinctBuildCount >= 0 && rawReceiverRuntime.distinctBuildCount <= receiverInstanceCount ? rawReceiverRuntime.distinctBuildCount : 0
  const receiverHash = boundedHash(rawReceiverRuntime?.currentAsarSha256)
  const candidateHash = rawReceiverRuntime?.candidateAsarSha256 === null ? null : boundedHash(rawReceiverRuntime?.candidateAsarSha256)
  const candidateMatch = rawReceiverRuntime?.candidateMatchesCurrent === null || typeof rawReceiverRuntime?.candidateMatchesCurrent === 'boolean'
    ? rawReceiverRuntime?.candidateMatchesCurrent
    : undefined
  const candidateShapeValid = candidateHash === null
    ? rawReceiverRuntime?.candidateAsarSha256 === null && candidateMatch === null
    : receiverHash !== null && candidateMatch === (candidateHash === receiverHash)
  const receiverShapeValid = receiverStatus === 'exclusive'
    ? receiverInstanceCount === 1 && receiverBuildCount === 1 && receiverHash !== null && candidateShapeValid
    : receiverStatus === 'contended_same_build'
      ? receiverInstanceCount >= 2 && receiverBuildCount === 1 && receiverHash !== null && candidateShapeValid
      : receiverStatus === 'contended_distinct_builds'
        ? receiverInstanceCount >= 2 && receiverBuildCount >= 2 && receiverHash !== null && candidateShapeValid
        : receiverStatus === 'not_running'
          ? receiverInstanceCount === 0 && receiverBuildCount === 0 && rawReceiverRuntime?.currentAsarSha256 === null && candidateShapeValid
          : receiverBuildCount === 0 && rawReceiverRuntime?.currentAsarSha256 === null && candidateShapeValid
  const receiverRuntime = {
    status: receiverShapeValid ? receiverStatus : 'unavailable',
    instanceCount: receiverShapeValid ? receiverInstanceCount : 0,
    distinctBuildCount: receiverShapeValid ? receiverBuildCount : 0,
    currentAsarSha256: receiverShapeValid ? receiverHash : null,
  }
  const expectedRequiredNames = declaredRoute === 'codex_native'
    ? NATIVE_REQUIRED_DOCTOR_CHECK_NAMES
    : ASHLR_REQUIRED_DOCTOR_CHECK_NAMES
  const requiredReady = required.length === expectedRequiredNames.size
    && requiredNames.size === expectedRequiredNames.size
    && [...expectedRequiredNames].every((name) => requiredNames.has(name))
    && required.every((item) => item.ok === true)
  const usbReady = uniqueCheckReady('Creator Micro 2 USB')
  const nativePrerequisitesReady = usbReady && uniqueCheckReady('ChatGPT desktop')
  const ashlrPrerequisitesReady = usbReady
    && uniqueCheckReady('Work Louder Input')
    && inputInstallation.status === 'verified'
  const rawRuntime = raw.inputRuntime && typeof raw.inputRuntime === 'object' ? raw.inputRuntime : null
  const runtimeStatus = rawRuntime && INPUT_RUNTIME_STATUSES.has(rawRuntime.status) ? rawRuntime.status : rawRuntime ? 'invalid' : null
  const runtimeProfileIndex = Number.isInteger(rawRuntime?.profileIndex) && rawRuntime.profileIndex >= 0 && rawRuntime.profileIndex <= 31 ? rawRuntime.profileIndex : null
  const runtimeLayerIndex = Number.isInteger(rawRuntime?.layerIndex) && rawRuntime.layerIndex >= 0 && rawRuntime.layerIndex <= 15 ? rawRuntime.layerIndex : null
  const runtimeObservedAt = boundedIsoTimestamp(rawRuntime?.observedAt)
  const projectedRuntimeStatus = runtimeStatus === 'unresolved_profile_layer' && (runtimeProfileIndex === null || runtimeLayerIndex === null || runtimeObservedAt === null)
    ? 'invalid'
    : runtimeStatus
  const rawCodexTraffic = rawRuntime?.codexProtocolTraffic && typeof rawRuntime.codexProtocolTraffic === 'object'
    ? rawRuntime.codexProtocolTraffic
    : null
  const codexTrafficStatus = rawCodexTraffic && CODEX_PROTOCOL_TRAFFIC_STATUSES.has(rawCodexTraffic.status)
    ? rawCodexTraffic.status
    : rawCodexTraffic ? 'invalid' : null
  const codexTrafficObservedAt = boundedIsoTimestamp(rawCodexTraffic?.observedAt)
  const projectedCodexTrafficStatus = codexTrafficStatus === 'recurring_unresolved_response' && codexTrafficObservedAt === null
    ? 'invalid'
    : codexTrafficStatus
  const rawProfile = raw.inputProfile && typeof raw.inputProfile === 'object' ? raw.inputProfile : null
  const cacheStatus = INPUT_CACHE_STATUSES.has(rawProfile?.cacheStatus) ? rawProfile.cacheStatus : 'invalid'
  const encoderDirection = INPUT_ENCODER_DIRECTIONS.has(rawProfile?.encoderDirection) ? rawProfile.encoderDirection : 'unavailable'
  const dailyProfileMatch = rawProfile?.dailyProfileMatch === true
  const dailyLayerMatch = rawProfile?.dailyLayerMatch === true
  const dailyProfileReady = cacheStatus === 'available' && dailyProfileMatch && dailyLayerMatch && encoderDirection === 'correct'
  const projectedNativeStatus = READINESS_STATUSES.has(raw.readiness?.codexNative?.status) ? raw.readiness.codexNative.status : 'unknown'
  const projectedNativeReason = NATIVE_REASONS.has(raw.readiness?.codexNative?.reason) ? raw.readiness.codexNative.reason : 'native_readiness_unavailable'
  const nativeFresh = raw.readiness?.codexNative?.fresh === true
  const nativeShapeValid = projectedNativeStatus === 'blocked' && projectedNativeReason === 'firmware_rpc_missing'
    ? nativeFresh
    : projectedNativeStatus === 'blocked' && projectedNativeReason === 'native_prerequisite_missing'
      ? !nativeFresh
    : projectedNativeStatus === 'pass' && projectedNativeReason === 'recent_native_connection_observed'
      ? nativeFresh
      : projectedNativeStatus === 'manual' && projectedNativeReason === 'historical_firmware_rpc_missing'
        ? !nativeFresh
        : projectedNativeStatus === 'manual' && projectedNativeReason === 'native_connection_requires_verification'
  const nativeStatus = nativeShapeValid ? projectedNativeStatus : 'unknown'
  const nativeReason = nativeShapeValid ? projectedNativeReason : 'native_readiness_unavailable'
  const ashlrStatus = READINESS_STATUSES.has(raw.readiness?.ashlrLayer?.status) ? raw.readiness.ashlrLayer.status : 'manual'
  const ashlrReason = ASHLR_REASONS.has(raw.readiness?.ashlrLayer?.reason) ? raw.readiness.ashlrLayer.reason : 'physical_acceptance_required'
  return {
    declaredRoute,
    inputProfile: rawProfile ? {
      cacheStatus,
      dailyProfileMatch,
      dailyLayerMatch,
      encoderDirection,
      dailyProfileReady,
    } : null,
    inputRuntime: rawRuntime ? {
      status: projectedRuntimeStatus,
      profileIndex: runtimeProfileIndex,
      layerIndex: runtimeLayerIndex,
      observedAt: runtimeObservedAt,
      fresh: projectedRuntimeStatus === 'unresolved_profile_layer' && rawRuntime.fresh === true,
      codexProtocolTraffic: rawCodexTraffic ? {
        status: projectedCodexTrafficStatus,
        observedAt: codexTrafficObservedAt,
        fresh: projectedCodexTrafficStatus === 'recurring_unresolved_response' && rawCodexTraffic.fresh === true,
      } : null,
    } : null,
    inputInstallation,
    receiverRuntime,
    requiredReady,
    nativePrerequisitesReady,
    ashlrPrerequisitesReady,
    nativeStatus,
    nativeReason,
    nativeFresh: nativeShapeValid && nativeFresh,
    ashlrStatus,
    ashlrReason,
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
  appDoctorRaw = parseJson(runCommand(process.execPath, [APP_DOCTOR, '--json']), { allowNonZero: true }),
  developmentBinary,
} = {}) {
  if (!ROUTES.has(route)) throw new Error(`route must be one of: ${[...ROUTES].join(', ')}`)

  const binary = stableBinarySnapshot(stable, developmentBinary)
  const appDoctor = projectAppDoctor(appDoctorRaw)
  const routePrerequisitesReady = route === 'codex_native'
    ? appDoctor?.nativePrerequisitesReady === true
    : appDoctor?.ashlrPrerequisitesReady === true
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
      routePrerequisitesReady ? 'pass' : appDoctor ? 'blocked' : 'warn',
      appDoctor ? `${route === 'codex_native' ? 'native' : 'Ashlr Layer'} desktop prerequisites ${routePrerequisitesReady ? 'passed' : 'did not pass'}` : 'desktop doctor output unavailable or incompatible',
      appDoctor ? 'desktop prerequisites are evaluated for the requested route and remain separate from physical acceptance' : 'run the desktop doctor directly for bounded diagnostics',
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
  const ashlrPrerequisitesReady = appDoctor?.ashlrPrerequisitesReady === true
  const inputInstallationReady = appDoctor?.inputInstallation?.status === 'verified'
  const knownInputResourceMutation = appDoctor?.inputInstallation?.status === 'known_resource_mutation'
  const ashlrReceiverReady = appDoctor?.receiverRuntime?.status === 'exclusive'
  let ashlrProfileObserved = false
  let ashlrProfileReady = false
  let ashlrInputOnlyWindowNeeded = false

  checks.push(check(
    'input_installation_integrity',
    inputInstallationReady ? 'pass' : route === 'ashlr_layer' ? 'blocked' : 'warn',
    `status=${appDoctor?.inputInstallation?.status ?? 'probe_unavailable'}; version=${appDoctor?.inputInstallation?.version ?? 'unavailable'}`,
    inputInstallationReady
      ? 'the exact vendor publisher, bundle signature, and Gatekeeper assessment passed'
      : route === 'codex_native'
        ? 'Input integrity is advisory for a read-only native retry because Input must remain quit; restore a verified signed copy before any later firmware or profile operation'
        : knownInputResourceMutation
          ? 'the known vendor resource mutation invalidates the signed bundle; fully quit Input, preserve a stopped-state profile backup, replace it with one official signed vendor copy, and rerun doctor before configuration or firmware work'
          : 'presence alone is insufficient; restore one official signed Work Louder Input installation before configuration or firmware work',
    inputInstallationReady ? 'agent' : 'human',
    inputInstallationReady ? 'read' : 'local_write',
  ))

  if (route === 'ashlr_layer') {
    const profile = appDoctor?.inputProfile
    ashlrProfileObserved = Boolean(profile)
    ashlrProfileReady = profile?.dailyProfileReady === true
    const runtime = appDoctor?.inputRuntime
    const runtimeUnavailable = ['log_missing', 'log_unsafe', 'log_unavailable', 'invalid'].includes(runtime?.status)
    const codexTraffic = runtime?.codexProtocolTraffic
    ashlrInputOnlyWindowNeeded = codexTraffic?.status === 'recurring_unresolved_response' && codexTraffic.fresh === true
    const codexTrafficUnavailable = ['log_missing', 'log_unsafe', 'log_unavailable', 'invalid'].includes(codexTraffic?.status)
    checks.push(check(
      'receiver_ownership',
      ashlrReceiverReady ? 'pass' : 'blocked',
      `status=${appDoctor?.receiverRuntime?.status ?? 'unavailable'}; instances=${appDoctor?.receiverRuntime?.instanceCount ?? 0}; builds=${appDoctor?.receiverRuntime?.distinctBuildCount ?? 0}`,
      ashlrReceiverReady
        ? 'one hashed Agent Board receiver may own the global shortcuts'
        : 'shortcut ownership fails closed; fully quit every Agent Board copy manually, then reopen one reviewed build',
      ashlrReceiverReady ? 'agent' : 'human',
      ashlrReceiverReady ? 'read' : 'local_write',
    ))
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
      'input_codex_protocol_traffic',
      codexTraffic?.status === 'recurring_unresolved_response' && codexTraffic.fresh || codexTrafficUnavailable ? 'warn' : codexTraffic ? 'pass' : 'warn',
      codexTraffic?.status === 'recurring_unresolved_response'
        ? `reason=recurring_unresolved_response; fresh=${codexTraffic.fresh}`
        : codexTrafficUnavailable ? `reason=${codexTraffic.status}; bounded Codex-protocol traffic evidence unavailable` : codexTraffic ? `reason=${codexTraffic.status}; no current recurring traffic projected` : 'bounded Codex-protocol traffic evidence unavailable',
      codexTraffic?.status === 'recurring_unresolved_response' && codexTraffic.fresh
        ? 'Input received recurring Codex-protocol responses for which it had no active resolver; this is co-presence evidence, not ownership, and Input-only reconciliation is not exclusive'
        : codexTrafficUnavailable ? 'traffic evidence is unavailable or unsafe; do not infer exclusive Input ownership' : codexTraffic ? 'no current recurring Codex-protocol traffic requires an advisory' : 'run the desktop doctor directly for bounded protocol traffic evidence',
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
    const nativePrerequisitesMissing = appDoctor?.nativeStatus === 'blocked'
      && appDoctor?.nativeReason === 'native_prerequisite_missing'
    const firmwareMissing = appDoctor?.nativeStatus === 'blocked'
      && appDoctor?.nativeReason === 'firmware_rpc_missing'
      && appDoctor?.nativeFresh === true
    const historicalFirmwareEvidence = appDoctor?.nativeReason === 'historical_firmware_rpc_missing'
    const nativeInitializationObserved = appDoctor?.nativeStatus === 'pass'
      && appDoctor?.nativeReason === 'recent_native_connection_observed'
      && appDoctor?.nativeFresh === true
    checks.push(check(
      'route_readiness',
      nativePrerequisitesMissing || firmwareMissing ? 'blocked' : 'manual',
      `Codex Native: ${appDoctor?.nativeReason ?? 'native connection requires manual verification'}`,
      nativePrerequisitesMissing
        ? 'Creator Micro 2 USB and ChatGPT desktop are required before a native connection receipt can be evaluated'
        : firmwareMissing
        ? 'a recent Codex receipt found the mandatory native RPC unavailable; only a guarded vendor firmware qualification can change that observed state'
        : historicalFirmwareEvidence
          ? 'the RPC failure evidence is historical; re-run the explicit native connection check before considering firmware'
          : nativeInitializationObserved
            ? 'a fresh ordered native initialization was inferred from bounded Codex logs; Settings connection and physical controls remain explicit human acceptance gates'
          : 'Codex Settings must show a native connection and physical controls must be accepted',
      'human',
      firmwareMissing ? 'firmware' : 'local_write',
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
  nextSteps.push(route === 'ashlr_layer' && !inputInstallationReady
    ? nextStep(
      'restore_signed_input', 'human', 'local_write', knownInputResourceMutation
        ? ['fully quit Work Louder Input', 'preserve a stopped-state profile backup before replacement', 'replace the modified app with one official signed Work Louder Input release', 'rerun the read-only doctor before reopening board controllers or considering firmware']
        : ['download the official Work Louder Input release', 'verify there is one intended installation', 'preserve profile backups before replacement'],
      'the desktop doctor verifies the exact vendor publisher, signature integrity, and Gatekeeper assessment',
      'profile activation, device synchronization, firmware compatibility, shortcut ownership, Input Monitoring, or physical acceptance',
    )
    : route === 'ashlr_layer'
      ? !ashlrReceiverReady
        ? nextStep(
          'reconcile_agent_board_receivers', 'human', 'local_write', ['save current work', 'fully quit every Agent Board copy manually', 'reopen one reviewed exact build'],
          'one hashed Agent Board receiver is available to own the 20 shortcuts',
          'Input Monitoring, profile activation, device synchronization, physical acceptance, native Codex RGB, or release readiness',
        )
        : !ashlrPrerequisitesReady
      ? nextStep(
        'resolve_ashlr_prerequisites', 'human', 'local_write', ['connect the Creator Micro 2 over USB', 'install the signed Work Louder Input app', 'rerun the read-only desktop doctor'],
        'the bounded desktop prerequisite probes are available and passing',
        'profile activation, device synchronization, Input Monitoring, physical acceptance, native Codex RGB, or release readiness',
      )
      : !ashlrProfileObserved
        ? nextStep(
          'inspect_input_profile', 'agent', 'read', [],
          'the bounded desktop doctor projects sanitized Input profile evidence',
          'profile activation, device synchronization, Input Monitoring, physical acceptance, or firmware compatibility',
          { executable: 'node', args: ['app/scripts/doctor.mjs', '--json'], cwd: '$REPO_ROOT' },
        )
        : ashlrInputOnlyWindowNeeded
          ? nextStep(
            'establish_input_only_recovery_window', 'human', 'local_write', ['end Flight Check', 'save the recovery checklist and rollback export', 'fully quit every board controller before opening Work Louder Input alone'],
            'the operator can perform the Input-only reconciliation and rerun preflight after reopening Agent Board',
            'HID ownership, profile activation, device synchronization, Input Monitoring, physical acceptance, native Codex RGB, or firmware compatibility',
          )
          : !ashlrProfileReady
            ? nextStep(
              'reconcile_input_profile', 'human', 'device_write', ['ordinary profile export saved as rollback', 'Codex, Agent Board, and competing controllers fully quit', 'Work Louder Input is the only board controller'],
              'the corrected profile is imported, set current, and still selected after Input relaunch',
              'device synchronization, Input Monitoring permission, physical shortcut receipt, native Codex RGB, or firmware compatibility',
            )
            : nextStep(
              'complete_ashlr_flight_check', 'human', 'permission', ['active corrected Input profile', 'Input Monitoring granted', 'actions suppressed'],
              'the named daily shortcut route emitted all expected physical gestures',
              'native Codex RGB, firmware compatibility, provider authority, or consequential-action approval',
            )
      : !routePrerequisitesReady
        ? nextStep(
          'resolve_native_prerequisites', 'human', 'local_write', ['connect the Creator Micro 2 over USB', 'install and open ChatGPT desktop', 'rerun the read-only desktop doctor'],
          'the bounded native USB and ChatGPT desktop prerequisites are available',
          'native RPC success, physical controls, Ashlr Layer readiness, provider authority, or release readiness',
        )
        : appDoctor?.nativeStatus === 'blocked' && appDoctor?.nativeReason === 'firmware_rpc_missing' && appDoctor?.nativeFresh === true
          && !inputInstallationReady
          ? nextStep(
            'restore_signed_input', 'human', 'local_write', knownInputResourceMutation
              ? ['fully quit Work Louder Input', 'preserve a stopped-state profile backup before replacement', 'replace the modified app with one official signed Work Louder Input release', 'rerun the read-only doctor before considering another firmware operation']
              : ['download the official Work Louder Input release', 'verify there is one intended installation', 'preserve profile backups before replacement'],
            'the desktop doctor verifies the exact vendor publisher, signature integrity, and Gatekeeper assessment before another firmware operation',
            'native connection, device synchronization, physical acceptance, or release readiness',
          )
          : appDoctor?.nativeStatus === 'blocked' && appDoctor?.nativeReason === 'firmware_rpc_missing' && appDoctor?.nativeFresh === true
        ? nextStep(
          'qualify_native_firmware', 'human', 'firmware', ['reviewed vendor-matched image', 'recorded checksum', 'stable power', 'recovery plan', 'Codex, Agent Board, and competing HID controllers quit; signed Work Louder Input is sole owner'],
          'the exact firmware and Codex build complete rgbcfg then thstatus and physical acceptance',
          'cross-provider Ashlr Layer readiness or general hardware compatibility',
        )
        : nextStep(
          'verify_native_connection', 'human', 'local_write', ['Creator Micro 2 present over USB', 'ChatGPT desktop installed', 'Work Louder Input and Agent Board fully quit', 'Codex opened alone'],
          'a fresh Codex Settings and physical-control receipt replaces historical or missing native evidence',
          'firmware compatibility, Ashlr Layer readiness, provider authority, or release readiness',
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
