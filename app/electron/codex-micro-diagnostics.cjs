const { existsSync, openSync, closeSync, readSync, readdirSync, statSync } = require('node:fs')
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
    connected: 'Codex reported a connected native Creator Micro control plane.',
    not_observed: 'No recent native Codex Creator Micro connection evidence was found.',
    log_unavailable: 'Codex desktop logs were unavailable for read-only inspection.',
  }
  return { status, observedAt, detail: details[status] }
}

function classifyCodexMicroLog(text) {
  if (typeof text !== 'string' || !text) return result('not_observed')
  const lines = text.split('\n')
  let pendingFirmwareFailure = null
  let latest = result('not_observed')
  for (const line of lines) {
    if (!line.includes('[CodexMicroService]')) continue
    if (/Connecting with HID/i.test(line)) {
      pendingFirmwareFailure = null
      latest = result('not_observed', observedAtFrom(line))
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
      continue
    }
  }
  return latest
}

function readTail(filePath) {
  const size = statSync(filePath).size
  const bytes = Math.min(size, MAX_TAIL_BYTES)
  const buffer = Buffer.alloc(bytes)
  const descriptor = openSync(filePath, 'r')
  try {
    readSync(descriptor, buffer, 0, bytes, Math.max(0, size - bytes))
  } finally {
    closeSync(descriptor)
  }
  return buffer.toString('utf8')
}

function dateParts(date) {
  return [String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')]
}

function evidenceTime(classified, fallbackMtimeMs) {
  const parsed = classified.observedAt ? Date.parse(classified.observedAt) : Number.NaN
  return Number.isFinite(parsed) ? parsed : fallbackMtimeMs
}

function classifyCandidate(candidate) {
  const cached = parsedFileCache.get(candidate.filePath)
  if (cached?.mtimeMs === candidate.mtimeMs && cached.size === candidate.size) return cached.classified
  const classified = classifyCodexMicroLog(readTail(candidate.filePath))
  parsedFileCache.set(candidate.filePath, { mtimeMs: candidate.mtimeMs, size: candidate.size, classified })
  return classified
}

function inspectCodexMicroLogs(home, now = new Date()) {
  try {
    const root = path.join(home, 'Library', 'Logs', 'com.openai.codex')
    const days = [now, new Date(now.getTime() - 24 * 60 * 60 * 1000)]
    const candidates = []
    for (const day of days) {
      const directory = path.join(root, ...dateParts(day))
      if (!existsSync(directory)) continue
      for (const name of readdirSync(directory)) {
        if (!name.endsWith('.log')) continue
        const filePath = path.join(directory, name)
        const stats = statSync(filePath)
        if (!stats.isFile() || stats.size === 0) continue
        candidates.push({ filePath, mtimeMs: stats.mtimeMs, size: stats.size })
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)
    let latest = null
    for (const candidate of candidates.slice(0, MAX_LOG_FILES)) {
      const classified = classifyCandidate(candidate)
      if (classified.status === 'not_observed' && !classified.observedAt) continue
      const time = evidenceTime(classified, candidate.mtimeMs)
      if (!latest || time > latest.time) latest = { classified, time }
    }
    if (!latest || latest.time - now.getTime() > 60_000) return result('not_observed')
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
