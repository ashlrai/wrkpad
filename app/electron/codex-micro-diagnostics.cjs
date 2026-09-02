const { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } = require('node:fs')
const path = require('node:path')

const MAX_LOG_FILES = 4
const MAX_TAIL_BYTES = 512 * 1024
const FRESHNESS_MS = 30 * 60 * 1000
const parsedFileCache = new Map()

function observedAtFrom(line) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(line)
  return match && Number.isFinite(Date.parse(match[1])) ? match[1] : null
}

function result(status, observedAt = null) {
  const details = {
    firmware_rpc_missing: 'Codex reached the board, but firmware returned RPC 404 for v.oai.rgbcfg.',
    connection_failed: 'Codex detected the board but its native control-plane initialization failed.',
    connected: 'An ordered Codex log sequence supports inferred native Creator Micro initialization.',
    not_observed: 'No recent native Codex Creator Micro connection evidence was found.',
    log_unavailable: 'Codex desktop logs were unavailable for read-only inspection.',
  }
  return { status, observedAt, detail: details[status] }
}

function classifyCodexMicroLog(text) {
  if (typeof text !== 'string' || !text) return result('not_observed')
  const lines = text.split('\n')
  let pendingFirmwareFailure = null
  let connectedAttempt = null
  let latest = result('not_observed')
  for (const line of lines) {
    if (!line.includes('[CodexMicroService]')) continue
    if (/Connecting with HID/i.test(line)) {
      pendingFirmwareFailure = null
      const observedAt = observedAtFrom(line)
      connectedAttempt = observedAt ? {
        pendingIds: new Set(),
        rgbConfigured: false,
        threadStatusConfigured: false,
        hidNotifications: false,
        radialNotifications: false,
        lastObservedMs: Date.parse(observedAt),
      } : null
      latest = result('not_observed', observedAt)
      continue
    }
    if (/v\.oai\.rgbcfg/.test(line) && /(?:rpcCode|RPC)[^\n]*404/.test(line)) {
      pendingFirmwareFailure = observedAtFrom(line)
      latest = result('firmware_rpc_missing', pendingFirmwareFailure)
      continue
    }
    if (/Codex Micro (?:connection|control-plane initialization) failed/i.test(line)) {
      latest = pendingFirmwareFailure
        ? result('firmware_rpc_missing', observedAtFrom(line) ?? pendingFirmwareFailure)
        : result('connection_failed', observedAtFrom(line))
      pendingFirmwareFailure = null
      connectedAttempt = null
      continue
    }
    if (/Codex Micro connection invalidated/i.test(line)) {
      latest = result('connection_failed', observedAtFrom(line))
      connectedAttempt = null
      continue
    }
    if (/Disconnecting HID device/i.test(line)) {
      if (latest.status === 'connected') latest = result('not_observed', observedAtFrom(line))
      pendingFirmwareFailure = null
      connectedAttempt = null
      continue
    }
    if (!connectedAttempt) continue
    const sending = /Sending RPC call, id:",(\d{1,4})/.exec(line)
    if (sending) {
      if (!advanceAttemptTimestamp(connectedAttempt, line)) {
        connectedAttempt = null
        continue
      }
      connectedAttempt.pendingIds.add(sending[1])
      continue
    }
    const received = /Received answer, id:",(\d{1,4}),"method:","(v\.oai\.(?:rgbcfg|thstatus))"/.exec(line)
    if (received) {
      if (!advanceAttemptTimestamp(connectedAttempt, line)) {
        connectedAttempt = null
        continue
      }
      if (!connectedAttempt.pendingIds.delete(received[1])) continue
      if (received[2] === 'v.oai.rgbcfg') {
        connectedAttempt.rgbConfigured = true
        connectedAttempt.threadStatusConfigured = false
      } else if (connectedAttempt.rgbConfigured) {
        connectedAttempt.threadStatusConfigured = true
      }
      continue
    }
    if (/Added notify handler for method:[^\n]*v\.oai\.hid/.test(line)) {
      if (!advanceAttemptTimestamp(connectedAttempt, line)) {
        connectedAttempt = null
        continue
      }
      connectedAttempt.hidNotifications = connectedAttempt.threadStatusConfigured
    }
    if (/Added notify handler for method:[^\n]*v\.oai\.rad/.test(line)) {
      if (!advanceAttemptTimestamp(connectedAttempt, line)) {
        connectedAttempt = null
        continue
      }
      connectedAttempt.radialNotifications = connectedAttempt.hidNotifications
    }
    if (
      connectedAttempt.rgbConfigured
      && connectedAttempt.threadStatusConfigured
      && connectedAttempt.hidNotifications
      && connectedAttempt.radialNotifications
    ) {
      latest = result('connected', observedAtFrom(line))
    }
  }
  return latest
}

function advanceAttemptTimestamp(attempt, line) {
  const observedAt = observedAtFrom(line)
  if (!observedAt) return false
  const observedMs = Date.parse(observedAt)
  if (observedMs < attempt.lastObservedMs) return false
  attempt.lastObservedMs = observedMs
  return true
}

function readTail(candidate) {
  assertUnchangedDirectoryChain(candidate.directoryChain)
  const descriptor = openSync(candidate.filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || stats.dev !== candidate.dev || stats.ino !== candidate.ino) throw new Error('unsafe Codex log file')
    assertUnchangedDirectoryChain(candidate.directoryChain)
    const bytes = Math.min(stats.size, MAX_TAIL_BYTES)
    const buffer = Buffer.alloc(bytes)
    readSync(descriptor, buffer, 0, bytes, Math.max(0, stats.size - bytes))
    assertUnchangedDirectoryChain(candidate.directoryChain)
    return buffer.toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

function dateParts(date) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')]
}

function evidenceTime(classified, fallbackMtimeMs) {
  const parsed = classified.observedAt ? Date.parse(classified.observedAt) : Number.NaN
  if (classified.status === 'connected') return parsed
  return Number.isFinite(parsed) ? parsed : fallbackMtimeMs
}

function appSessionKey(name) {
  const match = /^(codex-desktop-[0-9a-f-]+-\d+)-t\d+-i\d+-/.exec(name)
  return match?.[1] ?? null
}

function inspectDirectoryChain(canonicalHome, parts) {
  const root = path.join(canonicalHome, 'Library', 'Logs', 'com.openai.codex')
  const directory = path.join(root, ...parts)
  const relative = path.relative(root, directory)
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('unsafe Codex log directory')
  }

  const chain = []
  let current = canonicalHome
  for (const segment of ['Library', 'Logs', 'com.openai.codex', ...parts]) {
    current = path.join(current, segment)
    const stats = lstatSync(current, { throwIfNoEntry: false })
    if (!stats) return null
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error('unsafe Codex log directory')
    chain.push({ directory: current, dev: stats.dev, ino: stats.ino })
  }
  return { directory, chain }
}

function assertUnchangedDirectoryChain(chain) {
  for (const expected of chain) {
    const stats = lstatSync(expected.directory, { throwIfNoEntry: false })
    if (
      !stats
      || stats.isSymbolicLink()
      || !stats.isDirectory()
      || stats.dev !== expected.dev
      || stats.ino !== expected.ino
    ) throw new Error('unsafe Codex log directory')
  }
}

function classifyCandidate(candidate) {
  assertUnchangedDirectoryChain(candidate.directoryChain)
  const cached = parsedFileCache.get(candidate.filePath)
  if (
    cached?.mtimeMs === candidate.mtimeMs
    && cached.size === candidate.size
    && cached.dev === candidate.dev
    && cached.ino === candidate.ino
  ) {
    assertUnchangedDirectoryChain(candidate.directoryChain)
    return cached.classified
  }
  const classified = classifyCodexMicroLog(readTail(candidate))
  parsedFileCache.set(candidate.filePath, {
    mtimeMs: candidate.mtimeMs,
    size: candidate.size,
    dev: candidate.dev,
    ino: candidate.ino,
    classified,
  })
  return classified
}

function inspectCodexMicroLogs(home, now = new Date()) {
  try {
    const canonicalHome = realpathSync.native(path.resolve(home))
    const days = [now, new Date(now.getTime() - 24 * 60 * 60 * 1000)]
    const candidates = []
    for (const day of days) {
      const inspected = inspectDirectoryChain(canonicalHome, dateParts(day))
      if (!inspected) continue
      const names = readdirSync(inspected.directory)
      assertUnchangedDirectoryChain(inspected.chain)
      for (const name of names) {
        if (!name.endsWith('.log')) continue
        if (name !== path.basename(name)) throw new Error('unsafe Codex log file')
        const filePath = path.join(inspected.directory, name)
        const stats = lstatSync(filePath)
        if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('unsafe Codex log file')
        if (stats.size === 0) continue
        candidates.push({
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          dev: stats.dev,
          ino: stats.ino,
          sessionKey: appSessionKey(name),
          directoryChain: inspected.chain,
        })
      }
      assertUnchangedDirectoryChain(inspected.chain)
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
    const currentSessionKey = candidates[0]?.sessionKey
    const currentCandidates = currentSessionKey
      ? candidates.filter((candidate) => candidate.sessionKey === currentSessionKey)
      : candidates
    let latest = null
    for (const candidate of currentCandidates.slice(0, MAX_LOG_FILES)) {
      const classified = classifyCandidate(candidate)
      if (classified.status === 'not_observed' && !classified.observedAt) continue
      const time = evidenceTime(classified, candidate.mtimeMs)
      if (!Number.isFinite(time)) continue
      if (!latest || time > latest.time) latest = { classified, time }
    }
    if (!latest || latest.time - now.getTime() > 60_000) return result('not_observed')
    if (latest.classified.status === 'connected' && latest.time > now.getTime()) return result('not_observed')
    return { ...latest.classified, fresh: now.getTime() - latest.time <= FRESHNESS_MS }
  } catch {
    return result('log_unavailable')
  }
}

module.exports = {
  MAX_LOG_FILES,
  MAX_TAIL_BYTES,
  FRESHNESS_MS,
  classifyCodexMicroLog,
  inspectCodexMicroLogs,
}
