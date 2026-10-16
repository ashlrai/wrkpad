const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { closeSync, constants, fstatSync, lstatSync, openSync, readSync } = require('node:fs')
const path = require('node:path')

const MAIN_EXECUTABLE_SUFFIX = `${path.sep}Ashlr Agent Board.app${path.sep}Contents${path.sep}MacOS${path.sep}Ashlr Agent Board`
const ASAR_SUFFIX = `${path.sep}Contents${path.sep}Resources${path.sep}app.asar`
const BUNDLE_ASAR_SUFFIX = `${path.sep}Ashlr Agent Board.app${ASAR_SUFFIX}`
// Legacy Electron builds can contain unpacked dependency payloads in app.asar.
// Keep hashing bounded while still recognizing those real-world receivers.
const MAX_ASAR_BYTES = 512 * 1024 * 1024
const MAX_CANDIDATE_PATHS = 16
const MAX_INSTANCES = 64
const MAX_PATH_LENGTH = 4096
const MAX_PROCESS_LINE_BYTES = 16 * 1024
const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024
const MAX_PROCESS_ROWS = 4096
const MAX_PID = 2_147_483_647
const HASH_CHUNK_BYTES = 64 * 1024
const DEFAULT_HASH_CACHE_TTL_MS = 30_000
const DEFAULT_HASH_CACHE_MAX_ENTRIES = 32
const MAX_HASH_CACHE_TTL_MS = 5 * 60_000
const MAX_HASH_CACHE_ENTRIES = 64
const RECEIVER_PROCESS_PATTERN = 'Ashlr Agent Board\\.app/Contents/MacOS/Ashlr Agent Board$'

function result(status, instanceCount = 0, distinctBuildCount = 0, currentAsarSha256 = null, candidateAsarSha256 = null) {
  return {
    status,
    instanceCount,
    distinctBuildCount,
    currentAsarSha256,
    candidateAsarSha256,
    candidateMatchesCurrent: currentAsarSha256 && candidateAsarSha256
      ? currentAsarSha256 === candidateAsarSha256
      : null,
  }
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

function validLocalPath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_PATH_LENGTH
    && path.isAbsolute(value)
    && !hasUnsafeText(value)
}

function asarPathForExecutable(executablePath) {
  if (!validLocalPath(executablePath) || !executablePath.endsWith(MAIN_EXECUTABLE_SUFFIX)) return null
  return `${executablePath.slice(0, -MAIN_EXECUTABLE_SUFFIX.length)}${path.sep}Ashlr Agent Board.app${ASAR_SUFFIX}`
}

function executablePathForAsar(asarPath) {
  if (!validLocalPath(asarPath) || !asarPath.endsWith(BUNDLE_ASAR_SUFFIX)) return null
  return `${asarPath.slice(0, -BUNDLE_ASAR_SUFFIX.length)}${MAIN_EXECUTABLE_SUFFIX}`
}

function hashBoundedAsar(filePath) {
  if (!validLocalPath(filePath) || path.basename(filePath) !== 'app.asar') return { status: 'unsafe', sha256: null }
  let descriptor
  try {
    const pathStats = lstatSync(filePath)
    if (!pathStats.isFile() || pathStats.isSymbolicLink()) return { status: 'unsafe', sha256: null }
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.size < 1 || stats.size > MAX_ASAR_BYTES) return { status: 'unsafe', sha256: null }
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(Math.min(HASH_CHUNK_BYTES, stats.size))
    let offset = 0
    while (offset < stats.size) {
      const bytesRead = readSync(descriptor, buffer, 0, Math.min(buffer.length, stats.size - offset), offset)
      if (bytesRead <= 0) return { status: 'unavailable', sha256: null }
      hash.update(buffer.subarray(0, bytesRead))
      offset += bytesRead
    }
    return { status: 'available', sha256: hash.digest('hex') }
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'missing' : 'unavailable', sha256: null }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function boundedAsarIdentity(filePath) {
  if (!validLocalPath(filePath) || path.basename(filePath) !== 'app.asar') return { status: 'unsafe', identity: null }
  try {
    const stats = lstatSync(filePath, { bigint: true })
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 1n || stats.size > BigInt(MAX_ASAR_BYTES)) {
      return { status: 'unsafe', identity: null }
    }
    return {
      status: 'available',
      identity: `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`,
    }
  } catch (error) {
    return { status: error?.code === 'ENOENT' ? 'missing' : 'unavailable', identity: null }
  }
}

/**
 * Returns a bounded identity- and TTL-aware hasher for repeated main-process
 * probes. A cache hit still performs a cheap final-path lstat; file replacement
 * or mutation invalidates the entry before its TTL expires. Only successful
 * hashes are retained, and the cache never exposes paths or file metadata.
 */
function createCachedAsarHasher(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_HASH_CACHE_TTL_MS
  const maxEntries = options.maxEntries ?? DEFAULT_HASH_CACHE_MAX_ENTRIES
  const now = options.now ?? Date.now
  const hashAsar = options.hashAsar ?? hashBoundedAsar
  if (!Number.isInteger(ttlMs) || ttlMs < 0 || ttlMs > MAX_HASH_CACHE_TTL_MS
    || !Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_HASH_CACHE_ENTRIES
    || typeof now !== 'function' || typeof hashAsar !== 'function') {
    throw new TypeError('Invalid bounded ASAR cache options')
  }

  const cache = new Map()
  return (filePath) => {
    const before = boundedAsarIdentity(filePath)
    if (before.status !== 'available') return { status: before.status, sha256: null }
    let observedAt
    try {
      observedAt = now()
    } catch {
      return { status: 'unavailable', sha256: null }
    }
    if (!Number.isFinite(observedAt)) return { status: 'unavailable', sha256: null }

    const cached = cache.get(before.identity)
    const age = cached ? observedAt - cached.observedAt : null
    if (cached && age >= 0 && age <= ttlMs) {
      cache.delete(before.identity)
      cache.set(before.identity, cached)
      return { ...cached.value }
    }

    let hashed
    try {
      hashed = hashAsar(filePath)
    } catch {
      return { status: 'unavailable', sha256: null }
    }
    const normalized = normalizeHashResult(hashed)
    if (normalized.status !== 'available') return normalized
    const after = boundedAsarIdentity(filePath)
    if (after.status !== 'available' || after.identity !== before.identity) {
      return { status: 'unavailable', sha256: null }
    }

    cache.delete(before.identity)
    cache.set(before.identity, { observedAt, value: normalized })
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value)
    return { ...normalized }
  }
}

function parsePackagedRows(processText) {
  if (typeof processText !== 'string'
    || Buffer.byteLength(processText, 'utf8') > MAX_PROCESS_OUTPUT_BYTES
  ) return null

  const lines = processText.split('\n')
  if (lines.length > MAX_PROCESS_ROWS + 1) return null
  const rows = []
  const pids = new Set()
  for (const line of lines) {
    if (!line.trim()) continue
    const mentionsReceiver = line.includes('Ashlr Agent Board')
    if (Buffer.byteLength(line, 'utf8') > MAX_PROCESS_LINE_BYTES) {
      if (mentionsReceiver) return null
      continue
    }
    const match = /^\s*(\d{1,10})\s+(.+)$/.exec(line)
    if (!match) {
      if (mentionsReceiver) return null
      continue
    }
    const pid = Number(match[1])
    const command = match[2]
    if (!Number.isSafeInteger(pid) || pid < 1 || pid > MAX_PID) {
      if (mentionsReceiver) return null
      continue
    }
    if (!command.endsWith(MAIN_EXECUTABLE_SUFFIX)) continue
    if (!validLocalPath(command)) return null
    if (pids.has(pid)) return null
    pids.add(pid)
    rows.push({ pid, executablePath: command })
    if (rows.length > MAX_INSTANCES) return null
  }
  return rows
}

function parseMainRows(processText, currentPid) {
  if (!Number.isInteger(currentPid) || currentPid < 1 || currentPid > MAX_PID) return null
  const rows = parsePackagedRows(processText)
  if (!rows) return null
  return { rows, current: rows.find((row) => row.pid === currentPid) ?? null }
}

function firstCandidateHash(candidateAsarPaths, hashAsar, cache) {
  if (!Array.isArray(candidateAsarPaths) || candidateAsarPaths.length > MAX_CANDIDATE_PATHS) return { invalid: true, sha256: null }
  for (const candidatePath of candidateAsarPaths) {
    if (!validLocalPath(candidatePath) || path.basename(candidatePath) !== 'app.asar') return { invalid: true, sha256: null }
    const hashed = cachedHash(candidatePath, hashAsar, cache)
    if (hashed.status === 'missing') continue
    if (hashed.status !== 'available') return { invalid: true, sha256: null }
    return { invalid: false, sha256: hashed.sha256 }
  }
  return { invalid: false, sha256: null }
}

function normalizeHashResult(value) {
  if (!value || !['available', 'missing', 'unsafe', 'unavailable'].includes(value.status)) return { status: 'unavailable', sha256: null }
  if (value.status === 'available' && !/^[0-9a-f]{64}$/.test(value.sha256)) return { status: 'unavailable', sha256: null }
  if (value.status !== 'available' && value.sha256 !== null) return { status: 'unavailable', sha256: null }
  return { status: value.status, sha256: value.sha256 }
}

function cachedHash(filePath, hashAsar, cache) {
  if (!cache.has(filePath)) cache.set(filePath, hashAsar(filePath))
  return normalizeHashResult(cache.get(filePath))
}

function packagedPeerResult(status, instanceCount = 0) {
  return { status, instanceCount }
}

/**
 * Classifies packaged receivers without requiring the caller to be one of
 * them. Development builds use this bounded result to fail closed whenever a
 * packaged peer is present. Paths, command lines, and process IDs are omitted.
 */
function classifyPackagedReceiverPeers(processText) {
  const rows = parsePackagedRows(processText)
  if (!rows) return packagedPeerResult('unavailable')
  return rows.length === 0
    ? packagedPeerResult('none')
    : packagedPeerResult('present', rows.length)
}

/**
 * Classifies a fixed `pgrep -fl` snapshot. The optional hashAsar
 * injection makes the classifier deterministic in unit tests. Returned data is
 * deliberately limited to counts and content hashes; process IDs and paths are
 * never returned.
 */
function classifyReceiverRuntime(processText, options = {}) {
  const currentPid = options.currentPid ?? process.pid
  const candidateAsarPaths = options.candidateAsarPaths ?? []
  if (!Array.isArray(candidateAsarPaths) || candidateAsarPaths.length > MAX_CANDIDATE_PATHS) return result('unavailable')
  const declaredAsarPaths = [options.currentAsarPath, ...candidateAsarPaths].filter((value) => value !== undefined)
  if (declaredAsarPaths.some((value) => executablePathForAsar(value) === null)) return result('unavailable')
  const parsed = parseMainRows(processText, currentPid)
  if (!parsed) return result('unavailable')
  if (parsed.rows.length === 0) return result('not_running')
  if (!parsed.current) return result('unavailable', parsed.rows.length)
  const expectedCurrentExecutable = options.currentAsarPath ? executablePathForAsar(options.currentAsarPath) : null
  if (expectedCurrentExecutable && parsed.current.executablePath !== expectedCurrentExecutable) {
    return result('unavailable', parsed.rows.length)
  }

  const hashAsar = options.hashAsar ?? hashBoundedAsar
  if (typeof hashAsar !== 'function') return result('unavailable', parsed.rows.length)
  const cache = new Map()
  const derivedCurrentPath = asarPathForExecutable(parsed.current.executablePath)
  const currentAsarPath = options.currentAsarPath ?? derivedCurrentPath
  if (!currentAsarPath || !validLocalPath(currentAsarPath) || path.basename(currentAsarPath) !== 'app.asar') {
    return result('unavailable', parsed.rows.length)
  }
  const currentHash = cachedHash(currentAsarPath, hashAsar, cache)
  if (currentHash.status !== 'available') return result('unavailable', parsed.rows.length)

  const buildHashes = new Set()
  for (const row of parsed.rows) {
    const asarPath = row.pid === currentPid ? currentAsarPath : asarPathForExecutable(row.executablePath)
    if (!asarPath) return result('unavailable', parsed.rows.length)
    const hashed = cachedHash(asarPath, hashAsar, cache)
    if (hashed.status !== 'available') return result('unavailable', parsed.rows.length)
    buildHashes.add(hashed.sha256)
  }
  const distinctBuildCount = buildHashes.size
  const candidate = firstCandidateHash(candidateAsarPaths, hashAsar, cache)
  if (candidate.invalid) return result('unavailable', parsed.rows.length, distinctBuildCount)

  const status = parsed.rows.length === 1
    ? 'exclusive'
    : distinctBuildCount === 1 ? 'contended_same_build' : 'contended_distinct_builds'
  return result(status, parsed.rows.length, distinctBuildCount, currentHash.sha256, candidate.sha256)
}

/**
 * Runs a fixed, anchored `/usr/bin/pgrep -fl` probe unless processText is
 * supplied. An injected
 * run function receives the same fixed executable, argv, and bounded options and
 * must return a UTF-8 string (or null to report unavailable).
 */
function inspectReceiverRuntime(options = {}) {
  let processText = options.processText
  if (processText === undefined) {
    try {
      const run = options.run ?? execFileSync
      processText = run('/usr/bin/pgrep', ['-fl', RECEIVER_PROCESS_PATTERN], {
        encoding: 'utf8',
        timeout: 2_000,
        maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      if (error?.status === 1) processText = ''
      else return result('unavailable')
    }
  }
  if (processText === null) return result('unavailable')
  return classifyReceiverRuntime(processText, options)
}

function inspectPackagedReceiverPeers(options = {}) {
  let processText = options.processText
  if (processText === undefined) {
    try {
      const run = options.run ?? execFileSync
      processText = run('/usr/bin/pgrep', ['-fl', RECEIVER_PROCESS_PATTERN], {
        encoding: 'utf8',
        timeout: 2_000,
        maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      if (error?.status === 1) processText = ''
      else return packagedPeerResult('unavailable')
    }
  }
  if (processText === null) return packagedPeerResult('unavailable')
  return classifyPackagedReceiverPeers(processText)
}

/**
 * Shortcut ownership fails closed. Callers may register global shortcuts only
 * when this exact process is the sole recognized receiver and its build was
 * hashed successfully.
 */
function shouldRegisterShortcuts(runtime) {
  return Boolean(runtime)
    && runtime.status === 'exclusive'
    && runtime.instanceCount === 1
    && runtime.distinctBuildCount === 1
    && typeof runtime.currentAsarSha256 === 'string'
    && /^[0-9a-f]{64}$/.test(runtime.currentAsarSha256)
}

module.exports = {
  MAIN_EXECUTABLE_SUFFIX,
  DEFAULT_HASH_CACHE_MAX_ENTRIES,
  DEFAULT_HASH_CACHE_TTL_MS,
  MAX_ASAR_BYTES,
  MAX_CANDIDATE_PATHS,
  MAX_INSTANCES,
  MAX_PATH_LENGTH,
  MAX_PROCESS_LINE_BYTES,
  MAX_PROCESS_OUTPUT_BYTES,
  MAX_PROCESS_ROWS,
  RECEIVER_PROCESS_PATTERN,
  classifyPackagedReceiverPeers,
  classifyReceiverRuntime,
  createCachedAsarHasher,
  hashBoundedAsar,
  inspectPackagedReceiverPeers,
  inspectReceiverRuntime,
  shouldRegisterShortcuts,
}
