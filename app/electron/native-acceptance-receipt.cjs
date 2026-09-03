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

const NATIVE_ACCEPTANCE_SCHEMA = 'ai.ashlr.agent-board.native-acceptance/v1'
const NATIVE_ACCEPTANCE_FILENAME = 'native-acceptance-receipt.json'
const MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES = 8 * 1024
const MAX_INITIALIZATION_AGE_MS = 30 * 60 * 1000
const MAX_LOCAL_PATH_LENGTH = 4096
const ATTESTATION_KEYS = Object.freeze([
  'settingsConnected',
  'dial',
  'joystick',
  'agentKeys',
  'actionKeys',
  'microphone',
  'lighting',
])
const INITIALIZATION_STATUSES = new Set([
  'connected',
  'connection_failed',
  'disconnected',
  'firmware_rpc_missing',
  'not_observed',
  'log_unavailable',
])
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
  if (typeof value !== 'string' || value.length !== 24 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function sanitizeContext(value) {
  if (!exactKeys(value, ['route', 'device', 'codex']) || value.route !== 'codex_native') return null
  if (!exactKeys(value.device, ['vidPid'])) return null
  if (!exactKeys(value.codex, ['version', 'build'])) return null
  if (!VID_PID_PATTERN.test(value.device.vidPid ?? '')) return null
  if (!VERSION_PATTERN.test(value.codex.version ?? '') || !VERSION_PATTERN.test(value.codex.build ?? '')) return null
  return {
    route: 'codex_native',
    device: { vidPid: value.device.vidPid },
    codex: { version: value.codex.version, build: value.codex.build },
  }
}

function sanitizeAttestations(value, requireAll = false) {
  if (!exactKeys(value, ATTESTATION_KEYS)) return null
  const projected = {}
  for (const key of ATTESTATION_KEYS) {
    if (typeof value[key] !== 'boolean' || (requireAll && value[key] !== true)) return null
    projected[key] = value[key]
  }
  return projected
}

function blankAttestations() {
  return Object.fromEntries(ATTESTATION_KEYS.map((key) => [key, false]))
}

function sanitizeNativeAcceptanceReceipt(value) {
  if (!exactKeys(value, [
    'schema',
    'state',
    'preparedAt',
    'initializationObservedAt',
    'acceptedAt',
    'context',
    'attestations',
  ])) return null
  if (value.schema !== NATIVE_ACCEPTANCE_SCHEMA || !['prepared', 'accepted'].includes(value.state)) return null
  if (!validIsoTimestamp(value.preparedAt)) return null
  const context = sanitizeContext(value.context)
  if (!context) return null

  if (value.state === 'prepared') {
    const attestations = sanitizeAttestations(value.attestations)
    if (
      value.initializationObservedAt !== null
      || value.acceptedAt !== null
      || !attestations
      || ATTESTATION_KEYS.some((key) => attestations[key])
    ) return null
    return {
      schema: NATIVE_ACCEPTANCE_SCHEMA,
      state: 'prepared',
      preparedAt: value.preparedAt,
      initializationObservedAt: null,
      acceptedAt: null,
      context,
      attestations,
    }
  }

  const attestations = sanitizeAttestations(value.attestations, true)
  if (!attestations || !validIsoTimestamp(value.initializationObservedAt) || !validIsoTimestamp(value.acceptedAt)) return null
  if (
    Date.parse(value.initializationObservedAt) <= Date.parse(value.preparedAt)
    || Date.parse(value.acceptedAt) < Date.parse(value.initializationObservedAt)
  ) return null
  return {
    schema: NATIVE_ACCEPTANCE_SCHEMA,
    state: 'accepted',
    preparedAt: value.preparedAt,
    initializationObservedAt: value.initializationObservedAt,
    acceptedAt: value.acceptedAt,
    context,
    attestations,
  }
}

function nativeAcceptanceReceiptPath(settingsFilePath) {
  if (!validSettingsFilePath(settingsFilePath)) throw new TypeError('settingsFilePath must be an absolute local path')
  return path.join(path.dirname(settingsFilePath), NATIVE_ACCEPTANCE_FILENAME)
}

function readNativeAcceptanceReceipt(settingsFilePath) {
  const filePath = nativeAcceptanceReceiptPath(settingsFilePath)
  let descriptor
  try {
    const pathStats = lstatSync(filePath)
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) return null
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (
      !stats.isFile()
      || stats.dev !== pathStats.dev
      || stats.ino !== pathStats.ino
      || (stats.mode & 0o077) !== 0
      || stats.size < 2
      || stats.size > MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES
    ) return null
    return sanitizeNativeAcceptanceReceipt(JSON.parse(readFileSync(descriptor, 'utf8')))
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function writeNativeAcceptanceReceipt(settingsFilePath, value) {
  const receipt = sanitizeNativeAcceptanceReceipt(value)
  if (!receipt) throw new TypeError('native acceptance receipt is invalid')
  const filePath = nativeAcceptanceReceiptPath(settingsFilePath)
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStats = lstatSync(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) throw new TypeError('native acceptance settings directory is unsafe')

  try {
    const existing = lstatSync(filePath)
    if (existing.isSymbolicLink() || !existing.isFile()) throw new TypeError('native acceptance receipt path is unsafe')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const temporaryPath = path.join(directory, `.${NATIVE_ACCEPTANCE_FILENAME}.${randomUUID()}.tmp`)
  let temporaryExists = false
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    temporaryExists = true
    chmodSync(temporaryPath, 0o600)
    const currentDirectory = lstatSync(directory)
    if (
      currentDirectory.isSymbolicLink()
      || !currentDirectory.isDirectory()
      || currentDirectory.dev !== directoryStats.dev
      || currentDirectory.ino !== directoryStats.ino
    ) throw new TypeError('native acceptance settings directory changed')
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

function removeNativeAcceptanceReceipt(settingsFilePath) {
  const filePath = nativeAcceptanceReceiptPath(settingsFilePath)
  try {
    const stats = lstatSync(filePath)
    if (stats.isSymbolicLink() || !stats.isFile()) return false
    unlinkSync(filePath)
    return true
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

function prepareNativeAcceptance(context, preparedAt = new Date().toISOString()) {
  const receipt = sanitizeNativeAcceptanceReceipt({
    schema: NATIVE_ACCEPTANCE_SCHEMA,
    state: 'prepared',
    preparedAt,
    initializationObservedAt: null,
    acceptedAt: null,
    context,
    attestations: blankAttestations(),
  })
  if (!receipt) throw new TypeError('native acceptance preparation is invalid')
  return receipt
}

function projectInitialization(value) {
  if (!value || typeof value !== 'object' || !INITIALIZATION_STATUSES.has(value.status)) return null
  if (value.observedAt !== null && !validIsoTimestamp(value.observedAt)) return null
  if (typeof value.fresh !== 'boolean') return null
  return { status: value.status, observedAt: value.observedAt, fresh: value.fresh }
}

function sameContext(left, right) {
  return left.route === right.route
    && left.device.vidPid === right.device.vidPid
    && left.codex.version === right.codex.version
    && left.codex.build === right.codex.build
}

function evaluation(status, reason, receipt = null, initializationObservedAt = null) {
  return {
    status,
    reason,
    preparedAt: receipt?.preparedAt ?? null,
    initializationObservedAt: initializationObservedAt ?? receipt?.initializationObservedAt ?? null,
    acceptedAt: receipt?.acceptedAt ?? null,
    attestations: receipt?.attestations ?? blankAttestations(),
  }
}

function evaluateNativeAcceptance(receiptValue, options = {}) {
  if (receiptValue === null || receiptValue === undefined) return evaluation('not_prepared', 'receipt_missing')
  const receipt = sanitizeNativeAcceptanceReceipt(receiptValue)
  if (!receipt) return evaluation('invalid', 'receipt_invalid')
  const currentContext = sanitizeContext(options.currentContext)
  if (!currentContext) return evaluation('invalid', 'current_context_invalid', receipt)
  if (!sameContext(receipt.context, currentContext)) return evaluation('invalid', 'context_mismatch', receipt)
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now())
  if (!Number.isFinite(now.getTime())) return evaluation('invalid', 'current_time_invalid', receipt)
  const nowMs = now.getTime()
  if (Date.parse(receipt.preparedAt) > nowMs || (receipt.acceptedAt && Date.parse(receipt.acceptedAt) > nowMs)) {
    return evaluation('invalid', 'receipt_timestamp_future', receipt)
  }

  const initialization = projectInitialization(options.nativeInitialization)
  if (!initialization) return evaluation('invalid', 'initialization_evidence_invalid', receipt)
  if (initialization.status !== 'connected') {
    const reason = ['connection_failed', 'disconnected'].includes(initialization.status)
      ? 'initialization_disconnected'
      : 'initialization_not_observed'
    return evaluation('pending', reason, receipt)
  }
  if (initialization.observedAt === null) return evaluation('invalid', 'initialization_timestamp_missing', receipt)
  const initializationMs = Date.parse(initialization.observedAt)
  if (initializationMs > nowMs) return evaluation('invalid', 'initialization_timestamp_future', receipt)
  if (!initialization.fresh || nowMs - initializationMs > MAX_INITIALIZATION_AGE_MS) {
    return evaluation('pending', 'initialization_historical', receipt)
  }
  if (initializationMs <= Date.parse(receipt.preparedAt)) {
    return evaluation('pending', 'initialization_predates_preparation', receipt)
  }
  if (receipt.state === 'prepared') {
    return evaluation('initialization_observed', 'fresh_ordered_initialization_observed', receipt, initialization.observedAt)
  }
  if (initializationMs < Date.parse(receipt.initializationObservedAt)) {
    return evaluation('pending', 'accepted_initialization_not_current', receipt, initialization.observedAt)
  }
  return evaluation('accepted', 'all_native_controls_accepted', receipt)
}

function acceptNativeAcceptance(receiptValue, options = {}) {
  const receipt = sanitizeNativeAcceptanceReceipt(receiptValue)
  if (!receipt || receipt.state !== 'prepared') throw new TypeError('native acceptance must start from a valid preparation')
  const attestations = sanitizeAttestations(options.attestations, true)
  if (!attestations) throw new TypeError('every native acceptance attestation must be true')
  const acceptedAt = options.acceptedAt ?? new Date().toISOString()
  if (!validIsoTimestamp(acceptedAt)) throw new TypeError('acceptedAt must be an ISO timestamp')
  const observed = evaluateNativeAcceptance(receipt, {
    currentContext: options.currentContext,
    nativeInitialization: options.nativeInitialization,
    now: acceptedAt,
  })
  if (observed.status !== 'initialization_observed') {
    throw new TypeError(`native acceptance is not ready: ${observed.reason}`)
  }
  const accepted = sanitizeNativeAcceptanceReceipt({
    ...receipt,
    state: 'accepted',
    initializationObservedAt: observed.initializationObservedAt,
    acceptedAt,
    attestations,
  })
  if (!accepted) throw new TypeError('native acceptance timestamps are invalid')
  return accepted
}

module.exports = {
  ATTESTATION_KEYS,
  MAX_INITIALIZATION_AGE_MS,
  MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES,
  NATIVE_ACCEPTANCE_FILENAME,
  NATIVE_ACCEPTANCE_SCHEMA,
  acceptNativeAcceptance,
  evaluateNativeAcceptance,
  nativeAcceptanceReceiptPath,
  prepareNativeAcceptance,
  readNativeAcceptanceReceipt,
  removeNativeAcceptanceReceipt,
  sanitizeNativeAcceptanceReceipt,
  writeNativeAcceptanceReceipt,
}
