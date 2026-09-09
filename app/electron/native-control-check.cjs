const {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')

const NATIVE_CONTROL_CHECK_SCHEMA = 'ai.ashlr.agent-board.native-control-check/v1'
const NATIVE_CONTROL_CHECK_FILENAME = 'native-control-check.json'
const MAX_NATIVE_CONTROL_CHECK_BYTES = 8 * 1024
const MAX_LOCAL_PATH_LENGTH = 4096

const SETTINGS_OUTCOMES = Object.freeze([
  'connected_granted',
  'failed_or_ungranted',
  'not_checked',
])
const CONTROL_OUTCOMES = Object.freeze([
  'observed_response',
  'no_response',
  'unexpected_target',
  'not_configured',
  'skipped',
])
const OVERALL_OUTCOMES = Object.freeze([
  'incomplete',
  'reported_failure',
  'operator_accepted',
])
const AGENT_KEYS = Object.freeze(['AG00', 'AG01', 'AG02', 'AG03', 'AG04', 'AG05'])
const ACTION_KEYS = Object.freeze(['ACT06', 'ACT07', 'ACT08', 'ACT09', 'ACT10', 'ACT11', 'ACT12'])

const SETTINGS_OUTCOME_SET = new Set(SETTINGS_OUTCOMES)
const CONTROL_OUTCOME_SET = new Set(CONTROL_OUTCOMES)
const OVERALL_OUTCOME_SET = new Set(OVERALL_OUTCOMES)
const FAILURE_OUTCOME_SET = new Set(['no_response', 'unexpected_target'])
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/
const VID_PID_PATTERN = /^[0-9A-F]{4}:[0-9A-F]{4}$/

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function hasUnsafeText(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
  })
}

function validSettingsFilePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_LOCAL_PATH_LENGTH
    && path.isAbsolute(value)
    && !hasUnsafeText(value)
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function normalizedNow(value = Date.now()) {
  const now = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  return Number.isFinite(now.getTime()) ? now : null
}

function sanitizeContext(value) {
  if (!exactKeys(value, ['route', 'device', 'codex']) || value.route !== 'codex_native') return null
  if (!exactKeys(value.device, ['vidPid']) || !VID_PID_PATTERN.test(value.device.vidPid ?? '')) return null
  if (!exactKeys(value.codex, ['version', 'build'])) return null
  if (!VERSION_PATTERN.test(value.codex.version ?? '') || !VERSION_PATTERN.test(value.codex.build ?? '')) return null
  return {
    route: 'codex_native',
    device: { vidPid: value.device.vidPid },
    codex: { version: value.codex.version, build: value.codex.build },
  }
}

function sanitizeOutcomes(value) {
  if (!exactKeys(value, ['dial', 'joystick', 'agentKeys', 'actionKeys', 'lighting'])) return null
  if (!exactKeys(value.agentKeys, AGENT_KEYS)) return null
  if (!exactKeys(value.actionKeys, ACTION_KEYS)) return null
  for (const key of ['dial', 'joystick', 'lighting']) {
    if (!CONTROL_OUTCOME_SET.has(value[key])) return null
  }
  const agentKeys = {}
  for (const key of AGENT_KEYS) {
    if (!CONTROL_OUTCOME_SET.has(value.agentKeys[key])) return null
    agentKeys[key] = value.agentKeys[key]
  }
  const actionKeys = {}
  for (const key of ACTION_KEYS) {
    if (!CONTROL_OUTCOME_SET.has(value.actionKeys[key])) return null
    actionKeys[key] = value.actionKeys[key]
  }
  return {
    dial: value.dial,
    joystick: value.joystick,
    agentKeys,
    actionKeys,
    lighting: value.lighting,
  }
}

function flattenedOutcomes(outcomes) {
  return [
    outcomes.dial,
    outcomes.joystick,
    ...AGENT_KEYS.map((key) => outcomes.agentKeys[key]),
    ...ACTION_KEYS.map((key) => outcomes.actionKeys[key]),
    outcomes.lighting,
  ]
}

function deriveNativeControlCheckOverall(settings, outcomesValue) {
  if (!SETTINGS_OUTCOME_SET.has(settings)) throw new TypeError('native control-check settings outcome is invalid')
  const outcomes = sanitizeOutcomes(outcomesValue)
  if (!outcomes) throw new TypeError('native control-check outcomes are invalid')
  const values = flattenedOutcomes(outcomes)
  if (settings === 'failed_or_ungranted' || values.some((value) => FAILURE_OUTCOME_SET.has(value))) {
    return 'reported_failure'
  }
  if (settings === 'connected_granted' && values.every((value) => value === 'observed_response')) {
    return 'operator_accepted'
  }
  return 'incomplete'
}

function sameContext(left, right) {
  return left.route === right.route
    && left.device.vidPid === right.device.vidPid
    && left.codex.version === right.codex.version
    && left.codex.build === right.codex.build
}

function sanitizeNativeControlCheck(value, options = {}) {
  if (!exactKeys(value, ['schema', 'overall', 'reportedAt', 'context', 'settings', 'outcomes'])) return null
  if (value.schema !== NATIVE_CONTROL_CHECK_SCHEMA || !OVERALL_OUTCOME_SET.has(value.overall)) return null
  if (!validIsoTimestamp(value.reportedAt)) return null
  const now = normalizedNow(options.now)
  if (!now || Date.parse(value.reportedAt) > now.getTime()) return null
  const context = sanitizeContext(value.context)
  const outcomes = sanitizeOutcomes(value.outcomes)
  if (!context || !SETTINGS_OUTCOME_SET.has(value.settings) || !outcomes) return null
  if (deriveNativeControlCheckOverall(value.settings, outcomes) !== value.overall) return null

  if (options.currentContext !== undefined) {
    const currentContext = sanitizeContext(options.currentContext)
    if (!currentContext || !sameContext(context, currentContext)) return null
  }

  return {
    schema: NATIVE_CONTROL_CHECK_SCHEMA,
    overall: value.overall,
    reportedAt: value.reportedAt,
    context,
    settings: value.settings,
    outcomes,
  }
}

function createNativeControlCheck({ context, settings, outcomes, reportedAt = new Date().toISOString() }, options = {}) {
  const receipt = sanitizeNativeControlCheck({
    schema: NATIVE_CONTROL_CHECK_SCHEMA,
    overall: deriveNativeControlCheckOverall(settings, outcomes),
    reportedAt,
    context,
    settings,
    outcomes,
  }, { currentContext: context, now: options.now ?? Date.now() })
  if (!receipt) throw new TypeError('native control-check receipt is invalid')
  return receipt
}

function nativeControlCheckPath(settingsFilePath) {
  if (!validSettingsFilePath(settingsFilePath)) throw new TypeError('settingsFilePath must be an absolute local path')
  return path.join(path.dirname(settingsFilePath), NATIVE_CONTROL_CHECK_FILENAME)
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function inspectNativeControlCheckFile(filePath, options = {}) {
  let descriptor
  try {
    const pathStats = lstatSync(filePath)
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) return null
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (
      !stats.isFile()
      || !sameFileIdentity(stats, pathStats)
      || (stats.mode & 0o077) !== 0
      || stats.size < 2
      || stats.size > MAX_NATIVE_CONTROL_CHECK_BYTES
    ) return null
    return sanitizeNativeControlCheck(JSON.parse(readFileSync(descriptor, 'utf8')), options)
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function readNativeControlCheck(settingsFilePath, options = {}) {
  return inspectNativeControlCheckFile(nativeControlCheckPath(settingsFilePath), options)
}

function writeNativeControlCheck(settingsFilePath, value, options = {}) {
  const receipt = sanitizeNativeControlCheck(value, options)
  if (!receipt) throw new TypeError('native control-check receipt is invalid')
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_NATIVE_CONTROL_CHECK_BYTES) {
    throw new TypeError('native control-check receipt is too large')
  }

  const filePath = nativeControlCheckPath(settingsFilePath)
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStats = lstatSync(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new TypeError('native control-check settings directory is unsafe')
  }

  try {
    const existing = lstatSync(filePath)
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new TypeError('native control-check receipt path is unsafe')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const temporaryPath = path.join(directory, `.${NATIVE_CONTROL_CHECK_FILENAME}.${randomUUID()}.tmp`)
  let temporaryExists = false
  try {
    writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    temporaryExists = true
    chmodSync(temporaryPath, 0o600)
    const currentDirectory = lstatSync(directory)
    if (
      currentDirectory.isSymbolicLink()
      || !currentDirectory.isDirectory()
      || !sameFileIdentity(currentDirectory, directoryStats)
    ) throw new TypeError('native control-check settings directory changed')
    renameSync(temporaryPath, filePath)
    temporaryExists = false
    return receipt
  } finally {
    if (temporaryExists) {
      try {
        unlinkSync(temporaryPath)
      } catch {}
    }
  }
}

module.exports = {
  ACTION_KEYS,
  AGENT_KEYS,
  CONTROL_OUTCOMES,
  MAX_NATIVE_CONTROL_CHECK_BYTES,
  NATIVE_CONTROL_CHECK_FILENAME,
  NATIVE_CONTROL_CHECK_SCHEMA,
  OVERALL_OUTCOMES,
  SETTINGS_OUTCOMES,
  createNativeControlCheck,
  deriveNativeControlCheckOverall,
  nativeControlCheckPath,
  readNativeControlCheck,
  sanitizeNativeControlCheck,
  writeNativeControlCheck,
}
