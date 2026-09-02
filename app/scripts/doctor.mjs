import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { detectCreatorMicro2 } = require('../electron/creator-micro-identity.cjs')
const { inspectCodexMicroLogs } = require('../electron/codex-micro-diagnostics.cjs')
const { inspectInputProfile } = require('../electron/input-profile-diagnostics.cjs')
const { inspectInputRuntime } = require('../electron/input-runtime-diagnostics.cjs')
const { appSettingsPath, readAppSettings } = require('../electron/settings.cjs')
const { resolveTool } = require('../electron/tool-resolver.cjs')

const REQUIRED_CHECKS = [
  {
    key: 'board',
    name: 'Creator Micro 2 USB',
    nextAction: 'Connect the Creator Micro 2 with a data-capable USB-C cable, then rerun the doctor.',
  },
  {
    key: 'input',
    name: 'Work Louder Input',
    nextAction: 'Install the signed Work Louder Input app, then rerun the doctor.',
  },
]

const OPTIONAL_CHECKS = [
  { key: 'chatgpt', name: 'ChatGPT desktop' },
  { key: 'codex', name: 'Codex CLI' },
  { key: 'nativeCodex', name: 'Codex native Creator Micro' },
  { key: 'claude', name: 'Claude Code' },
  { key: 'ashlr', name: 'Ashlr Hub' },
  { key: 'logitech', name: 'Competing Logitech HID owner' },
]

const MANUAL_CHECKS = [
  {
    id: 'input-monitoring',
    name: 'Input Monitoring',
    detail: 'Verify the shortcut-receiving app in System Settings → Privacy & Security → Input Monitoring.',
  },
  {
    id: 'input-layer',
    name: 'Work Louder Input layer',
    detail: 'Verify the canonical daily shortcut layer is active in Work Louder Input.',
  },
  {
    id: 'flight-check',
    name: 'Physical Flight Check',
    detail: 'Run the Daily Flight Check in Agent Board and export a passing receipt.',
  },
]
const INPUT_RUNTIME_STATUSES = new Set(['unresolved_profile_layer', 'not_observed', 'log_missing', 'log_unsafe', 'log_unavailable'])
const CODEX_PROTOCOL_TRAFFIC_STATUSES = new Set(['recurring_unresolved_response', 'not_observed', 'log_missing', 'log_unsafe', 'log_unavailable'])
const boundedIsoTimestamp = (value) => {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : null
}

const makeCheck = (definition, probe, category) => ({
  name: definition.name,
  ok: Boolean(probe?.ok),
  detail: probe?.detail || 'unavailable',
  category,
  severity: probe?.ok ? 'pass' : category === 'required' ? 'error' : 'warning',
  blocking: category === 'required',
  ...(typeof probe?.code === 'string' ? { code: probe.code } : {}),
})

export function evaluateDoctor(probes, options = {}) {
  const requiredChecks = REQUIRED_CHECKS.map((definition) =>
    makeCheck(definition, probes[definition.key], 'required'),
  )
  const optionalChecks = OPTIONAL_CHECKS.map((definition) =>
    makeCheck(definition, probes[definition.key], 'optional'),
  )
  const failedRequiredIndex = requiredChecks.findIndex((check) => !check.ok)
  const nativeFirmwareMissing = probes.nativeCodex?.code === 'firmware_rpc_missing'
  const nativeRouteSelected = probes.boardRoute === 'codex_native'
  const route = ['codex_native', 'ashlr_layer'].includes(probes.boardRoute)
    ? probes.boardRoute
    : 'unknown'
  const inputProfile = probes.inputProfile ?? {
    cacheStatus: 'missing',
    activeProfile: null,
    activeLayer: null,
    encoderDirection: 'unavailable',
  }
  const dailyProfileReady = inputProfile.activeProfile === 'Ashlr Agent Board Corrected'
    && inputProfile.activeLayer === 'Ashlr Daily'
    && inputProfile.encoderDirection === 'correct'
  const rawInputRuntime = probes.inputRuntime ?? {}
  const inputRuntimeStatus = INPUT_RUNTIME_STATUSES.has(rawInputRuntime.status) ? rawInputRuntime.status : 'log_unavailable'
  const runtimeProfileIndex = Number.isInteger(rawInputRuntime.profileIndex) && rawInputRuntime.profileIndex >= 0 && rawInputRuntime.profileIndex <= 31 ? rawInputRuntime.profileIndex : null
  const runtimeLayerIndex = Number.isInteger(rawInputRuntime.layerIndex) && rawInputRuntime.layerIndex >= 0 && rawInputRuntime.layerIndex <= 15 ? rawInputRuntime.layerIndex : null
  const runtimeObservedAt = boundedIsoTimestamp(rawInputRuntime.observedAt)
  const unresolvedRuntimeShapeValid = inputRuntimeStatus !== 'unresolved_profile_layer'
    || (runtimeProfileIndex !== null && runtimeLayerIndex !== null && runtimeObservedAt !== null)
  const projectedRuntimeStatus = unresolvedRuntimeShapeValid ? inputRuntimeStatus : 'log_unavailable'
  const unresolvedRuntimeObserved = projectedRuntimeStatus === 'unresolved_profile_layer'
    && rawInputRuntime.fresh === true && runtimeProfileIndex !== null && runtimeLayerIndex !== null && runtimeObservedAt !== null
  const rawCodexTraffic = rawInputRuntime.codexProtocolTraffic && typeof rawInputRuntime.codexProtocolTraffic === 'object'
    ? rawInputRuntime.codexProtocolTraffic
    : null
  const codexTrafficStatus = rawCodexTraffic && CODEX_PROTOCOL_TRAFFIC_STATUSES.has(rawCodexTraffic.status)
    ? rawCodexTraffic.status
    : 'log_unavailable'
  const codexTrafficObservedAt = boundedIsoTimestamp(rawCodexTraffic?.observedAt)
  const codexTrafficShapeValid = codexTrafficStatus !== 'recurring_unresolved_response' || codexTrafficObservedAt !== null
  const projectedCodexTrafficStatus = codexTrafficShapeValid ? codexTrafficStatus : 'log_unavailable'
  const recurringCodexTrafficObserved = projectedCodexTrafficStatus === 'recurring_unresolved_response'
    && rawCodexTraffic?.fresh === true && codexTrafficObservedAt !== null
  const ashlrReason = failedRequiredIndex !== -1
    ? 'required_prerequisite_missing'
    : inputProfile.encoderDirection === 'reversed'
      ? 'encoder_direction_reversed'
      : !dailyProfileReady
        ? 'input_profile_requires_activation'
        : unresolvedRuntimeObserved
          ? 'recent_unresolved_profile_layer_observed'
          : recurringCodexTrafficObserved
            ? 'recurring_codex_protocol_traffic'
            : 'physical_acceptance_required'
  const manualChecks = MANUAL_CHECKS.map((check) => ({
    ...check,
    category: 'manual',
    status: 'manual',
    blocking: false,
  }))

  return {
    schema: 'ai.ashlr.agent-board.doctor/v1',
    observedAt: options.observedAt ?? new Date().toISOString(),
    readOnly: true,
    route,
    ok: failedRequiredIndex === -1,
    checks: [...requiredChecks, ...optionalChecks],
    inputProfile: {
      cacheStatus: inputProfile.cacheStatus,
      dailyProfileMatch: inputProfile.activeProfile === 'Ashlr Agent Board Corrected',
      dailyLayerMatch: inputProfile.activeLayer === 'Ashlr Daily',
      encoderDirection: inputProfile.encoderDirection,
      dailyProfileReady,
    },
    inputRuntime: {
      status: projectedRuntimeStatus,
      profileIndex: projectedRuntimeStatus === 'unresolved_profile_layer' ? runtimeProfileIndex : null,
      layerIndex: projectedRuntimeStatus === 'unresolved_profile_layer' ? runtimeLayerIndex : null,
      observedAt: projectedRuntimeStatus === 'unresolved_profile_layer' ? runtimeObservedAt : null,
      fresh: unresolvedRuntimeObserved,
      codexProtocolTraffic: {
        status: projectedCodexTrafficStatus,
        observedAt: projectedCodexTrafficStatus === 'recurring_unresolved_response' ? codexTrafficObservedAt : null,
        fresh: recurringCodexTrafficObserved,
      },
    },
    manualChecks,
    readiness: {
      prerequisites: {
        status: failedRequiredIndex === -1 ? 'pass' : 'blocked',
        reason: failedRequiredIndex === -1 ? 'required_checks_passed' : `required_check_failed:${REQUIRED_CHECKS[failedRequiredIndex].key}`,
      },
      codexNative: {
        status: nativeFirmwareMissing ? 'blocked' : probes.nativeCodex?.ok ? 'pass' : 'manual',
        reason: nativeFirmwareMissing ? 'firmware_rpc_missing' : probes.nativeCodex?.ok ? 'recent_native_connection_observed' : 'native_connection_requires_verification',
      },
      ashlrLayer: {
        status: failedRequiredIndex === -1 ? 'manual' : 'blocked',
        reason: ashlrReason,
      },
    },
    modeGuidance: {
      codexNative: nativeFirmwareMissing
        ? 'Codex observed v.oai.rgbcfg RPC 404. Back up Input profiles, then qualify a stable vendor firmware candidate with Codex fully quit; release strings alone do not prove compatibility.'
        : 'Native Codex requires an explicit connected receipt; process presence alone is not enough.',
      ashlrLayer: unresolvedRuntimeObserved
        ? 'Input recently logged an unresolved profile/layer combination. This event is advisory and may predate the current cache; a fresh physical Flight Check can supersede it.'
        : recurringCodexTrafficObserved
          ? 'Input is receiving recurring Codex-protocol responses for which it had no active resolver. This is co-presence evidence, not ownership; Input-only reconciliation is not exclusive.'
        : 'The Ashlr shortcut route remains independently commissionable through Work Louder Input and the physical Flight Check.',
    },
    nextAction:
      failedRequiredIndex === -1
        ? nativeFirmwareMissing && nativeRouteSelected
          ? 'For the declared Codex Native route, back up the Input profile and plan a guarded vendor firmware qualification with Codex fully quit.'
          : route === 'ashlr_layer' && inputProfile.encoderDirection === 'reversed'
            ? 'Create and activate the corrected Input profile before Flight Check.'
            : route === 'ashlr_layer' && !dailyProfileReady
              ? 'Use Set as current profile for Ashlr Agent Board Corrected and verify Ashlr Daily before Flight Check.'
              : unresolvedRuntimeObserved && route === 'ashlr_layer'
                ? 'Review the recent unresolved Input profile/layer event. If the board remains silent, complete the Input-only reconciliation before firmware qualification.'
                : recurringCodexTrafficObserved && route === 'ashlr_layer'
                  ? 'A human must establish an Input-only window before reconciliation; no application was quit and protocol traffic does not prove ownership.'
                : manualChecks[0].detail
        : REQUIRED_CHECKS[failedRequiredIndex].nextAction,
  }
}

const run = (executable, args) => {
  try {
    return execFileSync(executable, args, { encoding: 'utf8', timeout: 5000 }).trim()
  } catch {
    return null
  }
}

const toolProbe = (tool) => {
  const executable = resolveTool(tool, { home: homedir() })
  const version = executable ? run(executable, ['--version']) : null
  return { ok: Boolean(version), detail: version || 'unavailable' }
}

export { detectCreatorMicro2 }

export function collectProbes() {
  const home = homedir()
  const usb = run('/usr/sbin/ioreg', ['-p', 'IOUSB', '-n', 'Creator Micro 2', '-r', '-l'])
  const boardIdentity = detectCreatorMicro2(usb)
  const chatgptInstalled = existsSync('/Applications/ChatGPT.app')
  const inputInstalled = existsSync('/Applications/Input.app')
  const logitechOwner = run('/usr/bin/pgrep', ['-fl', 'logioptionsplus_agent'])
  const nativeCodex = inspectCodexMicroLogs(home)
  const settings = readAppSettings(appSettingsPath(join(home, 'Library', 'Application Support')), home)

  return {
    board: { ok: Boolean(boardIdentity), detail: boardIdentity ? `Work Louder ${boardIdentity.vidPid}${boardIdentity.evidence === 'candidate' ? ' candidate' : ''}` : 'not detected' },
    input: { ok: inputInstalled, detail: inputInstalled ? 'installed' : 'missing' },
    chatgpt: { ok: chatgptInstalled, detail: chatgptInstalled ? 'installed' : 'missing' },
    codex: toolProbe('codex'),
    nativeCodex: {
      ok: nativeCodex.status === 'connected' && nativeCodex.fresh === true,
      code: nativeCodex.status,
      detail: nativeCodex.status === 'firmware_rpc_missing'
        ? `v.oai.rgbcfg returned RPC 404${nativeCodex.fresh ? ' recently' : ` in historical evidence${nativeCodex.observedAt ? ` at ${nativeCodex.observedAt}` : ''}`}`
        : nativeCodex.detail,
    },
    boardRoute: settings.boardRoute,
    inputProfile: inspectInputProfile(home, boardIdentity?.storageId),
    inputRuntime: inspectInputRuntime(home),
    claude: toolProbe('claude'),
    ashlr: toolProbe('ashlr'),
    logitech: {
      ok: !logitechOwner,
      detail: logitechOwner ? 'running; generic HID-manager caution only' : 'not running',
    },
  }
}

function printHuman(result) {
  const sections = [
    ['Required', result.checks.filter((check) => check.category === 'required')],
    ['Optional integrations', result.checks.filter((check) => check.category === 'optional')],
  ]

  for (const [heading, checks] of sections) {
    console.log(`${heading}:`)
    for (const check of checks) console.log(`  ${check.ok ? '✓' : check.blocking ? '✕' : '!'} ${check.name}: ${check.detail}`)
  }

  console.log('Manual verification:')
  for (const check of result.manualChecks) console.log(`  • ${check.name}: ${check.detail}`)
  console.log(`\n${result.ok ? 'Doctor passed required checks.' : 'Doctor failed required checks.'}`)
  console.log(`Declared route: ${result.route}`)
  if (result.inputRuntime.fresh) console.log(`Input runtime: unresolved profile ${result.inputRuntime.profileIndex} / layer ${result.inputRuntime.layerIndex} observed recently`)
  if (result.inputRuntime.codexProtocolTraffic.fresh) console.log('Input runtime: recurring Codex-protocol responses observed; co-presence only, ownership unproven')
  console.log(`Next: ${result.nextAction}`)
}

function main() {
  const result = evaluateDoctor(collectProbes())
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
