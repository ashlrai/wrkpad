const {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const { spawnSync } = require('node:child_process')
const { createHash, randomUUID } = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const path = require('node:path')

const NATIVE_ACCEPTANCE_SCHEMA = 'ai.ashlr.agent-board.native-acceptance/v1'
const NATIVE_ACCEPTANCE_FILENAME = 'native-acceptance-receipt.json'
const NATIVE_ACCEPTANCE_LOCK_FILENAME = '.native-acceptance-receipt.lock'
const NATIVE_ACCEPTANCE_LOCK_SCHEMA = 'ai.ashlr.agent-board.native-acceptance-lock/v1'
const MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES = 8 * 1024
const MAX_NATIVE_ACCEPTANCE_LOCK_BYTES = 512
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const MAX_IDENTITY_PROBE_BYTES = 512
const IDENTITY_PROBE_TIMEOUT_MS = 500

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
  if (value.schema !== NATIVE_ACCEPTANCE_SCHEMA || !['prepared', 'accepting', 'accepted'].includes(value.state)) return null
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
  if (!attestations || !validIsoTimestamp(value.initializationObservedAt)) return null
  if (value.state === 'accepting') {
    if (value.acceptedAt !== null || Date.parse(value.initializationObservedAt) <= Date.parse(value.preparedAt)) return null
    return {
      schema: NATIVE_ACCEPTANCE_SCHEMA,
      state: 'accepting',
      preparedAt: value.preparedAt,
      initializationObservedAt: value.initializationObservedAt,
      acceptedAt: null,
      context,
      attestations,
    }
  }
  if (!validIsoTimestamp(value.acceptedAt)) return null
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

function inspectNativeAcceptanceReceiptFile(filePath) {
  let descriptor
  try {
    const pathStats = lstatSync(filePath)
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) return { status: 'invalid', receipt: null }
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (
      !stats.isFile()
      || stats.dev !== pathStats.dev
      || stats.ino !== pathStats.ino
      || (stats.mode & 0o077) !== 0
      || stats.size < 2
      || stats.size > MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES
    ) return { status: 'invalid', receipt: null }
    const receipt = sanitizeNativeAcceptanceReceipt(JSON.parse(readFileSync(descriptor, 'utf8')))
    return receipt ? { status: 'valid', receipt } : { status: 'invalid', receipt: null }
  } catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'absent', receipt: null }
      : { status: 'invalid', receipt: null }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function readNativeAcceptanceReceipt(settingsFilePath) {
  return inspectNativeAcceptanceReceiptFile(nativeAcceptanceReceiptPath(settingsFilePath)).receipt
}

function sanitizeExpectedReceipt(value) {
  if (value === null) return null
  const receipt = sanitizeNativeAcceptanceReceipt(value)
  if (!receipt) throw new TypeError('expected native acceptance receipt is invalid')
  return receipt
}

function receiptStateMatchesExpected(state, expected) {
  return expected === null
    ? state.status === 'absent'
    : state.status === 'valid' && isDeepStrictEqual(state.receipt, expected)
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function sameDirectoryIdentity(directory, expected) {
  const current = lstatSync(directory)
  return !current.isSymbolicLink()
    && current.isDirectory()
    && sameFileIdentity(current, expected)
}

function sanitizeLockOwner(value) {
  if (!exactKeys(value, ['schema', 'pid', 'nonce', 'bootId', 'processBirthId'])) return null
  if (value.schema !== NATIVE_ACCEPTANCE_LOCK_SCHEMA) return null
  if (!Number.isSafeInteger(value.pid) || value.pid < 1 || value.pid > 0x7fffffff) return null
  if (typeof value.nonce !== 'string' || !UUID_PATTERN.test(value.nonce)) return null
  if (process.platform === 'win32') {
    if (value.bootId !== null || value.processBirthId !== null) return null
  } else if (!SHA256_PATTERN.test(value.bootId ?? '') || !SHA256_PATTERN.test(value.processBirthId ?? '')) {
    return null
  }
  return {
    schema: NATIVE_ACCEPTANCE_LOCK_SCHEMA,
    pid: value.pid,
    nonce: value.nonce,
    bootId: value.bootId,
    processBirthId: value.processBirthId,
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function processPresence(pid) {
  try {
    process.kill(pid, 0)
    return 'alive'
  } catch (error) {
    return error?.code === 'ESRCH' ? 'dead' : 'unavailable'
  }
}

function readFixedIdentityFile(filePath) {
  let descriptor
  try {
    const pathStats = lstatSync(filePath)
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) return null
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || !sameFileIdentity(stats, pathStats)) return null
    const buffer = Buffer.alloc(MAX_IDENTITY_PROBE_BYTES + 1)
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, null)
    if (bytesRead < 1 || bytesRead > MAX_IDENTITY_PROBE_BYTES) return null
    const current = lstatSync(filePath)
    if (current.isSymbolicLink() || !current.isFile() || !sameFileIdentity(current, stats)) return null
    return buffer.subarray(0, bytesRead).toString('utf8').trim()
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function runFixedIdentityProbe(command, args) {
  try {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: { LC_ALL: 'C', TZ: 'UTC' },
      maxBuffer: MAX_IDENTITY_PROBE_BYTES,
      timeout: IDENTITY_PROBE_TIMEOUT_MS,
      windowsHide: true,
    })
    if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string') return null
    if (Buffer.byteLength(result.stdout, 'utf8') > MAX_IDENTITY_PROBE_BYTES) return null
    const output = result.stdout.trim().replace(/\s+/g, ' ')
    return output.length > 0 && output.length <= 128 && !hasUnsafeText(output) ? output : null
  } catch {
    return null
  }
}

function bootIdentity() {
  if (process.platform === 'win32') return null
  if (process.platform === 'linux') {
    const bootId = readFixedIdentityFile('/proc/sys/kernel/random/boot_id')
    return UUID_PATTERN.test(bootId ?? '') ? sha256(`linux-boot:${bootId}`) : null
  }
  if (process.platform === 'darwin') {
    const bootTime = runFixedIdentityProbe('/usr/sbin/sysctl', ['-n', 'kern.boottime'])
    const match = /^\{ sec = ([0-9]{1,20}), usec = ([0-9]{1,6}) \}(?: .*)?$/.exec(bootTime ?? '')
    return match ? sha256(`darwin-boot:${match[1]}:${match[2]}`) : null
  }
  const initStarted = runFixedIdentityProbe('/bin/ps', ['-o', 'lstart=', '-p', '1'])
  return initStarted ? sha256(`${process.platform}-session:${initStarted}`) : null
}

function linuxProcessBirth(pid) {
  const stat = readFixedIdentityFile(`/proc/${pid}/stat`)
  if (!stat) return null
  const commandEnd = stat.lastIndexOf(') ')
  if (commandEnd < 2) return null
  const fields = stat.slice(commandEnd + 2).trim().split(/\s+/)
  const startTicks = fields[19]
  return /^[0-9]{1,32}$/.test(startTicks ?? '') ? sha256(`linux-process:${startTicks}`) : null
}

function processBirthIdentity(pid) {
  if (process.platform === 'linux') return linuxProcessBirth(pid)
  const started = runFixedIdentityProbe('/bin/ps', ['-o', 'lstart=', '-p', String(pid)])
  return started ? sha256(`${process.platform}-process:${started}`) : null
}

function inspectProcessOwner(pid) {
  const initialPresence = processPresence(pid)
  if (initialPresence !== 'alive') return { status: initialPresence, processBirthId: null }
  if (process.platform === 'win32') return { status: 'alive', processBirthId: null }
  const processBirthId = processBirthIdentity(pid)
  if (processBirthId) return { status: 'alive', processBirthId }
  const finalPresence = processPresence(pid)
  return { status: finalPresence === 'dead' ? 'dead' : 'unavailable', processBirthId: null }
}

function currentLockOwner() {
  if (process.platform === 'win32') {
    return { schema: NATIVE_ACCEPTANCE_LOCK_SCHEMA, pid: process.pid, nonce: randomUUID(), bootId: null, processBirthId: null }
  }
  const currentBootId = bootIdentity()
  const processOwner = inspectProcessOwner(process.pid)
  if (!currentBootId || processOwner.status !== 'alive' || !processOwner.processBirthId) return null
  return {
    schema: NATIVE_ACCEPTANCE_LOCK_SCHEMA,
    pid: process.pid,
    nonce: randomUUID(),
    bootId: currentBootId,
    processBirthId: processOwner.processBirthId,
  }
}

function ownerIsDead(owner) {
  if (process.platform === 'win32') return processPresence(owner.pid) === 'dead'
  const currentBootId = bootIdentity()
  if (!currentBootId) return false
  if (currentBootId !== owner.bootId) return true
  const processOwner = inspectProcessOwner(owner.pid)
  if (processOwner.status === 'dead') return true
  return processOwner.status === 'alive'
    && processOwner.processBirthId !== null
    && processOwner.processBirthId !== owner.processBirthId
}

function reclaimDeadNativeAcceptanceLock(lockPath, directory, directoryStats) {
  let descriptor
  try {
    if (!sameDirectoryIdentity(directory, directoryStats)) return false
    const pathStats = lstatSync(lockPath)
    if (
      pathStats.isSymbolicLink()
      || !pathStats.isFile()
      || (pathStats.mode & 0o077) !== 0
      || pathStats.size < 2
      || pathStats.size > MAX_NATIVE_ACCEPTANCE_LOCK_BYTES
    ) return false
    descriptor = openSync(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (
      !stats.isFile()
      || !sameFileIdentity(stats, pathStats)
      || (stats.mode & 0o077) !== 0
      || stats.size !== pathStats.size
    ) return false
    const owner = sanitizeLockOwner(JSON.parse(readFileSync(descriptor, 'utf8')))
    if (!owner || !ownerIsDead(owner)) return false
    if (!sameDirectoryIdentity(directory, directoryStats)) return false
    const currentLock = lstatSync(lockPath)
    if (currentLock.isSymbolicLink() || !currentLock.isFile() || !sameFileIdentity(currentLock, stats)) return false
    unlinkSync(lockPath)
    return true
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function acquireNativeAcceptanceLock(lockPath, directory, directoryStats) {
  const owner = sanitizeLockOwner(currentLockOwner())
  if (!owner) throw new TypeError('native acceptance lock owner is invalid')
  const temporaryPath = path.join(directory, `${NATIVE_ACCEPTANCE_LOCK_FILENAME}.${owner.nonce}.tmp`)
  let descriptor
  let linked = false
  let lockIdentity
  let temporaryExists = false
  try {
    // Populate a private inode before publishing it as the fixed lock. A crash
    // can therefore leave either an unclaimed temp file or a verifiable owner,
    // never an empty fixed lock whose owner cannot be checked safely.
    descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
    temporaryExists = true
    writeFileSync(descriptor, `${JSON.stringify(owner)}\n`, { encoding: 'utf8' })
    chmodSync(temporaryPath, 0o600)
    const stats = fstatSync(descriptor)
    if (
      !stats.isFile()
      || (stats.mode & 0o077) !== 0
      || stats.size < 2
      || stats.size > MAX_NATIVE_ACCEPTANCE_LOCK_BYTES
      || !sameDirectoryIdentity(directory, directoryStats)
    ) throw new TypeError('native acceptance receipt lock is unsafe')
    try {
      linkSync(temporaryPath, lockPath)
    } catch (error) {
      if (error?.code !== 'EEXIST' || !reclaimDeadNativeAcceptanceLock(lockPath, directory, directoryStats)) throw error
      linkSync(temporaryPath, lockPath)
    }
    linked = true
    lockIdentity = stats
    const lockStats = lstatSync(lockPath)
    if (lockStats.isSymbolicLink() || !lockStats.isFile() || !sameFileIdentity(lockStats, stats)) {
      throw new TypeError('native acceptance receipt lock changed')
    }
    unlinkSync(temporaryPath)
    temporaryExists = false
    return { descriptor, lockStats }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (linked && lockIdentity) {
      try {
        const currentLock = lstatSync(lockPath)
        if (sameDirectoryIdentity(directory, directoryStats) && currentLock.isFile() && sameFileIdentity(currentLock, lockIdentity)) {
          unlinkSync(lockPath)
        }
      } catch {}
    }
    if (temporaryExists) {
      try {
        unlinkSync(temporaryPath)
      } catch {}
    }
    throw error
  }
}

function withNativeAcceptanceLock(settingsFilePath, operation) {
  const filePath = nativeAcceptanceReceiptPath(settingsFilePath)
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStats = lstatSync(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) throw new TypeError('native acceptance settings directory is unsafe')

  const lockPath = path.join(directory, NATIVE_ACCEPTANCE_LOCK_FILENAME)
  let lockDescriptor
  let lockStats
  try {
    const lock = acquireNativeAcceptanceLock(lockPath, directory, directoryStats)
    lockDescriptor = lock.descriptor
    lockStats = lock.lockStats
    const currentDirectory = lstatSync(directory)
    if (
      currentDirectory.isSymbolicLink()
      || !currentDirectory.isDirectory()
      || currentDirectory.dev !== directoryStats.dev
      || currentDirectory.ino !== directoryStats.ino
    ) throw new TypeError('native acceptance settings directory changed')
    return operation({ directory, directoryStats, filePath })
  } catch {
    throw new TypeError('native acceptance receipt is busy or unsafe')
  } finally {
    if (lockDescriptor !== undefined) closeSync(lockDescriptor)
    if (lockStats) {
      try {
        const currentLock = lstatSync(lockPath)
        if (currentLock.isFile() && currentLock.dev === lockStats.dev && currentLock.ino === lockStats.ino) unlinkSync(lockPath)
      } catch {}
    }
  }
}

function writeNativeAcceptanceReceipt(settingsFilePath, value, expectedValue) {
  if (arguments.length < 3) throw new TypeError('expected native acceptance receipt is required')
  const receipt = sanitizeNativeAcceptanceReceipt(value)
  if (!receipt) throw new TypeError('native acceptance receipt is invalid')
  const expected = sanitizeExpectedReceipt(expectedValue)

  return withNativeAcceptanceLock(settingsFilePath, ({ directory, directoryStats, filePath }) => {
    if (!receiptStateMatchesExpected(inspectNativeAcceptanceReceiptFile(filePath), expected)) {
      throw new TypeError('native acceptance receipt changed')
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
  })
}

function removeNativeAcceptanceReceipt(settingsFilePath, expectedValue) {
  if (arguments.length < 2) throw new TypeError('expected native acceptance receipt is required')
  const expected = sanitizeExpectedReceipt(expectedValue)
  return withNativeAcceptanceLock(settingsFilePath, ({ filePath }) => {
    const current = inspectNativeAcceptanceReceiptFile(filePath)
    if (!receiptStateMatchesExpected(current, expected)) return false
    if (current.status === 'absent') return true
    try {
      unlinkSync(filePath)
      return true
    } catch {
      return false
    }
  })
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
  if (receipt.state === 'accepting') {
    if (initializationMs < Date.parse(receipt.initializationObservedAt)) {
      return evaluation('pending', 'accepting_initialization_not_current', receipt, initialization.observedAt)
    }
    return evaluation('pending', 'acceptance_incomplete', receipt)
  }
  if (initializationMs < Date.parse(receipt.initializationObservedAt)) {
    return evaluation('pending', 'accepted_initialization_not_current', receipt, initialization.observedAt)
  }
  return evaluation('accepted', 'all_native_controls_accepted', receipt)
}

function stageNativeAcceptance(receiptValue, options = {}) {
  const receipt = sanitizeNativeAcceptanceReceipt(receiptValue)
  if (!receipt || receipt.state !== 'prepared') throw new TypeError('native acceptance must start from a valid preparation')
  const attestations = sanitizeAttestations(options.attestations, true)
  if (!attestations) throw new TypeError('every native acceptance attestation must be true')
  const stagedAt = options.stagedAt ?? new Date().toISOString()
  if (!validIsoTimestamp(stagedAt)) throw new TypeError('stagedAt must be an ISO timestamp')
  const observed = evaluateNativeAcceptance(receipt, {
    currentContext: options.currentContext,
    nativeInitialization: options.nativeInitialization,
    now: stagedAt,
  })
  if (observed.status !== 'initialization_observed') {
    throw new TypeError(`native acceptance is not ready: ${observed.reason}`)
  }
  const accepting = sanitizeNativeAcceptanceReceipt({
    ...receipt,
    state: 'accepting',
    initializationObservedAt: observed.initializationObservedAt,
    acceptedAt: null,
    attestations,
  })
  if (!accepting) throw new TypeError('native acceptance staging is invalid')
  return accepting
}

function acceptNativeAcceptance(receiptValue, options = {}) {
  const receipt = sanitizeNativeAcceptanceReceipt(receiptValue)
  if (!receipt || receipt.state !== 'accepting') throw new TypeError('native acceptance must start from a valid accepting receipt')
  const acceptedAt = options.acceptedAt ?? new Date().toISOString()
  if (!validIsoTimestamp(acceptedAt)) throw new TypeError('acceptedAt must be an ISO timestamp')
  const preparedProjection = {
    ...receipt,
    state: 'prepared',
    initializationObservedAt: null,
    acceptedAt: null,
    attestations: blankAttestations(),
  }
  const observed = evaluateNativeAcceptance(preparedProjection, {
    currentContext: options.currentContext,
    nativeInitialization: options.nativeInitialization,
    now: acceptedAt,
  })
  if (observed.status !== 'initialization_observed') {
    throw new TypeError(`native acceptance promotion is not ready: ${observed.reason}`)
  }
  if (Date.parse(observed.initializationObservedAt) < Date.parse(receipt.initializationObservedAt)) {
    throw new TypeError('native acceptance promotion initialization is stale')
  }
  const accepted = sanitizeNativeAcceptanceReceipt({ ...receipt, state: 'accepted', acceptedAt })
  if (!accepted) throw new TypeError('native acceptance timestamps are invalid')
  return accepted
}

module.exports = {
  ATTESTATION_KEYS,
  MAX_INITIALIZATION_AGE_MS,
  MAX_NATIVE_ACCEPTANCE_RECEIPT_BYTES,
  NATIVE_ACCEPTANCE_FILENAME,
  NATIVE_ACCEPTANCE_LOCK_FILENAME,
  NATIVE_ACCEPTANCE_LOCK_SCHEMA,
  NATIVE_ACCEPTANCE_SCHEMA,
  acceptNativeAcceptance,
  evaluateNativeAcceptance,
  nativeAcceptanceReceiptPath,
  prepareNativeAcceptance,
  readNativeAcceptanceReceipt,
  removeNativeAcceptanceReceipt,
  sanitizeNativeAcceptanceReceipt,
  stageNativeAcceptance,
  writeNativeAcceptanceReceipt,
}
