const { closeSync, constants, fstatSync, lstatSync, openSync, readSync } = require('node:fs')
const path = require('node:path')

const MAX_LOG_TAIL_BYTES = 512 * 1024
const FRESHNESS_MS = 30 * 60 * 1000
const MAX_PROFILE_INDEX = 31
const MAX_LAYER_INDEX = 15
const MISMATCH_PATTERN = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\] \[error\] \|window_service\|\s+cannot find specific profile index: (\d{1,3}) and layer index: (\d{1,3}) combination\s*$/

function result(status, profileIndex = null, layerIndex = null, observedAt = null, fresh = false) {
  return { status, profileIndex, layerIndex, observedAt, fresh }
}

function timestampFrom(match) {
  const parts = match.slice(1, 8).map(Number)
  const [year, month, day, hour, minute, second, millisecond] = parts
  const timestamp = new Date(year, month - 1, day, hour, minute, second, millisecond)
  if (
    timestamp.getFullYear() !== year
    || timestamp.getMonth() !== month - 1
    || timestamp.getDate() !== day
    || timestamp.getHours() !== hour
    || timestamp.getMinutes() !== minute
    || timestamp.getSeconds() !== second
    || timestamp.getMilliseconds() !== millisecond
  ) return null
  return timestamp
}

function classifyInputRuntimeLog(text, now = new Date()) {
  if (typeof text !== 'string' || !(now instanceof Date) || !Number.isFinite(now.getTime())) return result('not_observed')
  let latest = null
  for (const line of text.split('\n')) {
    const match = MISMATCH_PATTERN.exec(line)
    if (!match) continue
    const profileIndex = Number(match[8])
    const layerIndex = Number(match[9])
    if (profileIndex > MAX_PROFILE_INDEX || layerIndex > MAX_LAYER_INDEX) continue
    const timestamp = timestampFrom(match)
    if (!timestamp || (latest && timestamp <= latest.timestamp)) continue
    latest = { profileIndex, layerIndex, timestamp }
  }
  if (!latest) return result('not_observed')
  const age = now.getTime() - latest.timestamp.getTime()
  return result(
    'profile_layer_mismatch',
    latest.profileIndex,
    latest.layerIndex,
    latest.timestamp.toISOString(),
    age >= -60_000 && age <= FRESHNESS_MS,
  )
}

function inputLogPath(home) {
  return path.join(home, 'Library', 'Logs', 'input', 'main.log')
}

function pathHasSymlink(home, filePath) {
  const relative = path.relative(home, filePath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return true
  let current = home
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    if (lstatSync(current).isSymbolicLink()) return true
  }
  return false
}

function inspectInputRuntime(home, now = new Date()) {
  let descriptor
  try {
    const filePath = inputLogPath(home)
    if (pathHasSymlink(home, filePath)) return result('log_unsafe')
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) return result('log_unsafe')
    const bytes = Math.min(stats.size, MAX_LOG_TAIL_BYTES)
    if (bytes === 0) return result('not_observed')
    const buffer = Buffer.alloc(bytes)
    readSync(descriptor, buffer, 0, bytes, Math.max(0, stats.size - bytes))
    let text = buffer.toString('utf8')
    if (stats.size > bytes) text = text.slice(Math.max(0, text.indexOf('\n') + 1))
    return classifyInputRuntimeLog(text, now)
  } catch (error) {
    return result(error?.code === 'ENOENT' ? 'log_missing' : 'log_unavailable')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

module.exports = {
  FRESHNESS_MS,
  MAX_LAYER_INDEX,
  MAX_LOG_TAIL_BYTES,
  MAX_PROFILE_INDEX,
  classifyInputRuntimeLog,
  inspectInputRuntime,
}
