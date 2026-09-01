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
  const ashlrReason = failedRequiredIndex !== -1
    ? 'required_prerequisite_missing'
    : inputProfile.encoderDirection === 'reversed'
      ? 'encoder_direction_reversed'
      : dailyProfileReady ? 'physical_acceptance_required' : 'input_profile_requires_activation'
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
      ashlrLayer: 'The Ashlr shortcut route remains independently commissionable through Work Louder Input and the physical Flight Check.',
    },
    nextAction:
      failedRequiredIndex === -1
        ? nativeFirmwareMissing && nativeRouteSelected
          ? 'For the declared Codex Native route, back up the Input profile and plan a guarded vendor firmware qualification with Codex fully quit.'
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
  console.log(`Next: ${result.nextAction}`)
}

function main() {
  const result = evaluateDoctor(collectProbes())
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)
  process.exitCode = result.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
