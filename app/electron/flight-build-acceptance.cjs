const {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  opendirSync,
  openSync,
  readSync,
} = require('node:fs')
const { createHash } = require('node:crypto')
const path = require('node:path')

const FLIGHT_RECEIPT_SCHEMA = 'ai.ashlr.agent-board.flight-check/v2'
const MAX_FLIGHT_RECEIPT_BYTES = 200_000
const MAX_FLIGHT_RECEIPT_FILES = 128
const MAX_FLIGHT_RECEIPT_DIRECTORY_ENTRIES = 4096
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const RECEIPT_FILENAME_PATTERN = /^ashlr-agent-board-flight-check-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/

const HOTKEYS = Object.freeze({
  agent1: 'Control+Alt+Command+1', agent2: 'Control+Alt+Command+2',
  agent3: 'Control+Alt+Command+3', agent4: 'Control+Alt+Command+4',
  agent5: 'Control+Alt+Command+5', agent6: 'Control+Alt+Command+6',
  cmd1: 'Control+Alt+Command+A', cmd2: 'Control+Alt+Command+B',
  cmd3: 'Control+Alt+Command+C', cmd4: 'Control+Alt+Command+D',
  cmd5: 'Control+Alt+Command+E', cmd6: 'Control+Alt+Command+F',
  cmd7: 'Control+Alt+Command+G',
  joyUp: 'Control+Alt+Command+Up', joyRight: 'Control+Alt+Command+Right',
  joyDown: 'Control+Alt+Command+Down', joyLeft: 'Control+Alt+Command+Left',
  dialLeft: 'Control+Alt+Command+Q', dialRight: 'Control+Alt+Command+W',
  dialPress: 'Control+Alt+Command+R',
})

const EXPECTED_SIGNAL_ORDER = Object.freeze([
  'dialLeft', 'dialLeft', 'dialLeft',
  'dialRight', 'dialRight', 'dialRight',
  'dialPress', 'agent1', 'agent2',
  'joyUp', 'joyRight', 'joyDown', 'joyLeft',
  'agent3', 'agent4', 'agent5', 'agent6',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7',
])
const EXPECTED_UNIQUE_SIGNALS = Object.freeze([...new Set(EXPECTED_SIGNAL_ORDER)])
const EDGE_SIGNAL_IDS = Object.freeze([
  'agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7', 'dialPress',
])

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function validVersion(value) {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/.test(value)
}

function hasUnsafePathText(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
  })
}

function sameArray(left, right) {
  return Array.isArray(left) && left.length === right.length
    && left.every((value, index) => value === right[index])
}

function validRegistrationSet(value) {
  if (!Array.isArray(value) || value.length !== EXPECTED_UNIQUE_SIGNALS.length) return false
  const registrations = new Map()
  for (const item of value) {
    if (!exactKeys(item, ['signalId', 'accelerator', 'registered'])
      || item.registered !== true
      || HOTKEYS[item.signalId] !== item.accelerator
      || registrations.has(item.signalId)) return false
    registrations.set(item.signalId, item)
  }
  return EXPECTED_UNIQUE_SIGNALS.every((signalId) => registrations.has(signalId))
}

function validRawEvents(value) {
  if (!Array.isArray(value) || value.length !== EXPECTED_SIGNAL_ORDER.length) return false
  let priorSequence = 0
  let priorTime = -Infinity
  let priorMonotonic = -1n
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index]
    if (!exactKeys(item, ['schemaVersion', 'sequence', 'signalId', 'source', 'accelerator', 'receivedAt', 'monotonicNs'])
      || item.schemaVersion !== 1
      || item.source !== 'global-shortcut'
      || item.signalId !== EXPECTED_SIGNAL_ORDER[index]
      || item.accelerator !== HOTKEYS[item.signalId]
      || !Number.isSafeInteger(item.sequence)
      || item.sequence <= priorSequence
      || !validIsoTimestamp(item.receivedAt)
      || typeof item.monotonicNs !== 'string'
      || !/^\d{1,32}$/.test(item.monotonicNs)) return false
    const receivedAt = Date.parse(item.receivedAt)
    const monotonicNs = BigInt(item.monotonicNs)
    if (receivedAt < priorTime || monotonicNs <= priorMonotonic) return false
    priorSequence = item.sequence
    priorTime = receivedAt
    priorMonotonic = monotonicNs
  }
  return true
}

function validSuppression(value, rawEvents) {
  if (!exactKeys(value, [
    'policy', 'windowMs', 'inclusive', 'nonSliding', 'maxPerAcceptedEdge',
    'eligibleSignals', 'suppressedCount', 'droppedCount', 'events',
  ])) return false
  if (value.policy !== 'adjacent-edge-once/v1'
    || value.windowMs !== 35
    || value.inclusive !== true
    || value.nonSliding !== true
    || value.maxPerAcceptedEdge !== 1
    || !sameArray(value.eligibleSignals, EDGE_SIGNAL_IDS)
    || !Number.isSafeInteger(value.suppressedCount)
    || value.suppressedCount < 0
    || value.suppressedCount > EXPECTED_SIGNAL_ORDER.length
    || value.droppedCount !== 0
    || !Array.isArray(value.events)
    || value.events.length !== value.suppressedCount) return false

  const acceptedBySequence = new Map(rawEvents.map((event) => [event.sequence, event]))
  const suppressedAcceptedSequences = new Set()
  return value.events.every((item) => {
    if (!exactKeys(item, [
      'signalId', 'accelerator', 'receivedAt', 'monotonicNs', 'route',
      'receiverGeneration', 'priorAcceptedSequence', 'deltaNs', 'reason',
    ])) return false
    const accepted = acceptedBySequence.get(item.priorAcceptedSequence)
    const isValid = !suppressedAcceptedSequences.has(item.priorAcceptedSequence)
      && EDGE_SIGNAL_IDS.includes(item.signalId)
      && item.accelerator === HOTKEYS[item.signalId]
      && validIsoTimestamp(item.receivedAt)
      && typeof item.monotonicNs === 'string'
      && /^\d{1,32}$/.test(item.monotonicNs)
      && item.route === 'ashlr_layer'
      && Number.isSafeInteger(item.receiverGeneration)
      && item.receiverGeneration >= 0
      && typeof item.deltaNs === 'string'
      && /^\d{1,16}$/.test(item.deltaNs)
      && BigInt(item.deltaNs) <= 35_000_000n
      && BigInt(item.monotonicNs) > BigInt(accepted.monotonicNs)
      && BigInt(item.monotonicNs) - BigInt(accepted.monotonicNs) === BigInt(item.deltaNs)
      && item.reason === 'adjacent_duplicate_within_window'
      && accepted?.signalId === item.signalId
      && accepted?.accelerator === item.accelerator
      && Date.parse(item.receivedAt) >= Date.parse(accepted.receivedAt)
    if (isValid) suppressedAcceptedSequences.add(item.priorAcceptedSequence)
    return isValid
  })
}

function dailyProfileProjection(value, dualPlaneAshlrLayerSelected) {
  if (!exactKeys(value, ['cacheStatus', 'activeProfile', 'activeLayer', 'encoderDirection', 'configuredLayers'])
    || value.cacheStatus !== 'available'
    || value.encoderDirection !== 'correct'
    || !Array.isArray(value.configuredLayers)) return null
  const singleLayer = value.activeProfile === 'Ashlr Agent Board Corrected'
    && value.activeLayer === 'Ashlr Daily'
    && dualPlaneAshlrLayerSelected === false
    && value.configuredLayers.length === 1
    && exactKeys(value.configuredLayers[0], ['name', 'mapping', 'encoderDirection'])
    && value.configuredLayers[0].name === 'Ashlr Daily'
    && value.configuredLayers[0].mapping === 'ashlr_daily'
    && value.configuredLayers[0].encoderDirection === 'correct'
  if (singleLayer) return { profileName: value.activeProfile, layerName: value.activeLayer }

  const dualPlane = value.activeProfile === 'Ashlr Dual Plane (UNOFFICIAL)'
    && value.activeLayer === null
    && dualPlaneAshlrLayerSelected === true
    && value.configuredLayers.length === 2
    && value.configuredLayers.every((layer) => exactKeys(layer, ['name', 'mapping', 'encoderDirection']))
    && value.configuredLayers[0].name === 'Codex Native Recovery (UNOFFICIAL)'
    && value.configuredLayers[0].mapping === 'codex_native'
    && value.configuredLayers[1].name === 'Ashlr Daily'
    && value.configuredLayers[1].mapping === 'ashlr_daily'
    && value.configuredLayers[1].encoderDirection === 'correct'
  return dualPlane ? { profileName: value.activeProfile, layerName: null } : null
}

function validAdmission(value, appAsarSha256) {
  if (!exactKeys(value, [
    'boardRoute', 'dualPlaneAshlrLayerSelected', 'usbDetected', 'inputInstallation',
    'inputProfile', 'profileFailure', 'receiverRuntime', 'inputApplication', 'shortcuts',
  ]) || value.boardRoute !== 'ashlr_layer'
    || typeof value.dualPlaneAshlrLayerSelected !== 'boolean'
    || value.usbDetected !== true) return null
  if (!exactKeys(value.inputInstallation, ['status', 'version'])
    || value.inputInstallation.status !== 'verified'
    || !validVersion(value.inputInstallation.version)) return null
  const profile = dailyProfileProjection(value.inputProfile, value.dualPlaneAshlrLayerSelected)
  if (!profile || value.profileFailure !== null) return null
  if (!exactKeys(value.receiverRuntime, ['status', 'instanceCount', 'distinctBuildCount', 'currentAsarSha256'])
    || value.receiverRuntime.status !== 'exclusive'
    || value.receiverRuntime.instanceCount !== 1
    || value.receiverRuntime.distinctBuildCount !== 1
    || value.receiverRuntime.currentAsarSha256 !== appAsarSha256) return null
  if (!exactKeys(value.shortcuts, ['registeredCount', 'expectedCount'])
    || value.shortcuts.registeredCount !== 20
    || value.shortcuts.expectedCount !== 20) return null
  if (!exactKeys(value.inputApplication, ['status'])
    || !['running', 'not_running', 'unavailable'].includes(value.inputApplication.status)) return null
  return profile
}

function validEvaluation(value) {
  return exactKeys(value, [
    'status', 'completedGestures', 'expectedGestures', 'expectedSignals',
    'receivedSignals', 'missingSignals', 'problems', 'expectedCallbackCount',
    'acceptedCallbackCount',
  ])
    && value.status === 'passed'
    && value.completedGestures === 20
    && value.expectedGestures === 20
    && value.expectedSignals === 20
    && sameArray(value.receivedSignals, EXPECTED_UNIQUE_SIGNALS)
    && Array.isArray(value.missingSignals) && value.missingSignals.length === 0
    && Array.isArray(value.problems) && value.problems.length === 0
    && value.expectedCallbackCount === 24
    && value.acceptedCallbackCount === 24
}

function sanitizeFlightBuildAcceptanceReceipt(value) {
  if (!exactKeys(value, [
    'schema', 'receiptId', 'profileKind', 'status', 'startedAt', 'exportedAt',
    'appVersion', 'device', 'configuration', 'evaluation',
    'duplicateSuppression', 'rawEvents', 'disclaimer', 'sha256',
  ])) return null
  if (value.schema !== FLIGHT_RECEIPT_SCHEMA
    || !UUID_V4_PATTERN.test(value.receiptId ?? '')
    || value.profileKind !== 'daily'
    || value.status !== 'passed'
    || !validIsoTimestamp(value.startedAt)
    || !validIsoTimestamp(value.exportedAt)
    || Date.parse(value.exportedAt) < Date.parse(value.startedAt)
    || !validVersion(value.appVersion)
    || !exactKeys(value.device, ['expectedName', 'usbDetected'])
    || value.device.expectedName !== 'Creator Micro 2'
    || value.device.usbDetected !== true
    || value.disclaimer !== 'Operator-guided global-shortcut receipt; not a cryptographic device-identity attestation.'
    || !SHA256_PATTERN.test(value.sha256 ?? '')
    || !validRawEvents(value.rawEvents)
    || Date.parse(value.rawEvents[0].receivedAt) < Date.parse(value.startedAt)
    || Date.parse(value.rawEvents.at(-1).receivedAt) > Date.parse(value.exportedAt)
    || !validEvaluation(value.evaluation)
    || !validSuppression(value.duplicateSuppression, value.rawEvents)) return null

  const configuration = value.configuration
  if (!exactKeys(configuration, ['registrations', 'registeredCount', 'admission', 'gates', 'dualPlaneLayerAttestation'])
    || !validRegistrationSet(configuration.registrations)
    || configuration.registeredCount !== 20
    || !exactKeys(configuration.gates, ['variant', 'route', 'usb', 'input', 'profile', 'receiver', 'shortcuts'])
    || !Object.values(configuration.gates).every((gate) => gate === true)) return null

  const appAsarSha256 = configuration.admission?.receiverRuntime?.currentAsarSha256
  const profile = SHA256_PATTERN.test(appAsarSha256 ?? '')
    ? validAdmission(configuration.admission, appAsarSha256)
    : null
  if (!profile) return null
  if (configuration.admission.dualPlaneAshlrLayerSelected) {
    if (!exactKeys(configuration.dualPlaneLayerAttestation, ['source', 'attestedAt'])
      || configuration.dualPlaneLayerAttestation.source !== 'operator'
      || !validIsoTimestamp(configuration.dualPlaneLayerAttestation.attestedAt)
      || Date.parse(configuration.dualPlaneLayerAttestation.attestedAt) > Date.parse(value.startedAt)) return null
  } else if (configuration.dualPlaneLayerAttestation !== null) return null

  const canonical = { ...value }
  delete canonical.sha256
  const recomputedSha256 = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  if (recomputedSha256 !== value.sha256) return null

  return Object.freeze({
    acceptedAt: value.rawEvents.at(-1).receivedAt,
    exportedAt: value.exportedAt,
    appVersion: value.appVersion,
    appAsarSha256,
    route: 'ashlr_layer',
    profileKind: 'daily',
    profileName: profile.profileName,
    layerName: profile.layerName,
    expectedCallbackCount: 24,
    acceptedCallbackCount: 24,
    suppressedDuplicateCount: value.duplicateSuppression.suppressedCount,
    receiptSha256: value.sha256,
  })
}

function emptyProjection(status) {
  return Object.freeze({
    status,
    acceptedAt: null,
    exportedAt: null,
    appVersion: null,
    appAsarSha256: null,
    route: null,
    profileKind: null,
    profileName: null,
    layerName: null,
    expectedCallbackCount: null,
    acceptedCallbackCount: null,
    suppressedDuplicateCount: null,
    receiptSha256: null,
  })
}

function projectAcceptance(status, receipt) {
  return Object.freeze({ status, ...receipt })
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function privateOwnerOnly(stat) {
  if (process.platform === 'win32') return true
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : null
  return (currentUid === null || stat.uid === currentUid) && (stat.mode & 0o077) === 0
}

function readReceiptFile(filePath) {
  let descriptor
  try {
    const before = lstatSync(filePath)
    if (!before.isFile() || before.isSymbolicLink() || !privateOwnerOnly(before)
      || before.size < 2 || before.size > MAX_FLIGHT_RECEIPT_BYTES) return null
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const after = fstatSync(descriptor)
    if (!after.isFile() || !sameFileIdentity(before, after) || !privateOwnerOnly(after)
      || after.size < 2 || after.size > MAX_FLIGHT_RECEIPT_BYTES) return null
    const bytes = Buffer.alloc(after.size)
    let offset = 0
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null)
      if (count === 0) return null
      offset += count
    }
    const overflow = Buffer.alloc(1)
    const final = fstatSync(descriptor)
    if (!sameFileIdentity(after, final) || final.size !== after.size
      || readSync(descriptor, overflow, 0, 1, null) !== 0) return null
    return sanitizeFlightBuildAcceptanceReceipt(JSON.parse(bytes.toString('utf8')))
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function inspectFlightBuildAcceptance({ receiptDirectory, currentAppAsarSha256 }) {
  if (typeof receiptDirectory !== 'string' || !path.isAbsolute(receiptDirectory)
    || receiptDirectory.length > 4096 || hasUnsafePathText(receiptDirectory)) {
    throw new TypeError('receiptDirectory must be a bounded absolute path')
  }
  if (!SHA256_PATTERN.test(currentAppAsarSha256 ?? '')) {
    throw new TypeError('currentAppAsarSha256 must be a lowercase SHA-256 digest')
  }

  let entries
  let directoryDescriptor
  let directoryIdentity
  let directoryHandle
  try {
    const directory = lstatSync(receiptDirectory)
    if (!directory.isDirectory() || directory.isSymbolicLink() || !privateOwnerOnly(directory)) return emptyProjection('invalid')
    directoryDescriptor = openSync(receiptDirectory, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0))
    directoryIdentity = fstatSync(directoryDescriptor)
    if (!directoryIdentity.isDirectory() || !sameFileIdentity(directory, directoryIdentity) || !privateOwnerOnly(directoryIdentity)) {
      return emptyProjection('invalid')
    }
    directoryHandle = opendirSync(receiptDirectory)
    entries = []
    while (entries.length <= MAX_FLIGHT_RECEIPT_DIRECTORY_ENTRIES) {
      const entry = directoryHandle.readSync()
      if (!entry) break
      entries.push(entry)
    }
  } catch (error) {
    return emptyProjection(error?.code === 'ENOENT' ? 'absent' : 'invalid')
  } finally {
    if (directoryHandle !== undefined) {
      try { directoryHandle.closeSync() } catch {}
    }
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor)
  }
  if (entries.length > MAX_FLIGHT_RECEIPT_DIRECTORY_ENTRIES) return emptyProjection('invalid')

  let candidateCount = 0
  const valid = []
  const candidates = entries
    .filter((entry) => RECEIPT_FILENAME_PATTERN.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name))
    .slice(0, MAX_FLIGHT_RECEIPT_FILES)
  for (const entry of candidates) {
    try {
      const currentDirectory = lstatSync(receiptDirectory)
      if (!sameFileIdentity(currentDirectory, directoryIdentity) || !privateOwnerOnly(currentDirectory)) return emptyProjection('invalid')
    } catch {
      return emptyProjection('invalid')
    }
    if (entry.isSymbolicLink()) return emptyProjection('invalid')
    candidateCount += 1
    if (!entry.isFile()) continue
    const receipt = readReceiptFile(path.join(receiptDirectory, entry.name))
    if (receipt) valid.push(receipt)
  }
  try {
    const finalDirectory = lstatSync(receiptDirectory)
    if (!sameFileIdentity(finalDirectory, directoryIdentity) || !privateOwnerOnly(finalDirectory)) return emptyProjection('invalid')
  } catch {
    return emptyProjection('invalid')
  }
  if (valid.length === 0) return emptyProjection(candidateCount === 0 ? 'absent' : 'invalid')

  valid.sort((left, right) => right.exportedAt.localeCompare(left.exportedAt)
    || right.receiptSha256.localeCompare(left.receiptSha256))
  const matching = valid.find((receipt) => receipt.appAsarSha256 === currentAppAsarSha256)
  return matching
    ? projectAcceptance('current_build_accepted', matching)
    : projectAcceptance('accepted_other_build', valid[0])
}

module.exports = {
  FLIGHT_RECEIPT_SCHEMA,
  MAX_FLIGHT_RECEIPT_BYTES,
  MAX_FLIGHT_RECEIPT_DIRECTORY_ENTRIES,
  MAX_FLIGHT_RECEIPT_FILES,
  inspectFlightBuildAcceptance,
  sanitizeFlightBuildAcceptanceReceipt,
}
