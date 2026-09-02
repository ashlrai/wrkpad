const { closeSync, constants, fstatSync, lstatSync, openSync, readSync } = require('node:fs')
const path = require('node:path')

const MAX_LOG_TAIL_BYTES = 512 * 1024
const FRESHNESS_MS = 30 * 60 * 1000
const CODEX_TRAFFIC_FRESHNESS_MS = 30 * 1000
const CODEX_TRAFFIC_RECURRENCE_MS = 20 * 1000
const MAX_PROFILE_INDEX = 31
const MAX_LAYER_INDEX = 15
const MISMATCH_PATTERN = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\] \[error\] \|window_service\|\s+cannot find specific profile index: (\d{1,3}) and layer index: (\d{1,3}) combination\s*$/
const CODEX_RESPONSE_PATTERN = /^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\] \[warn\]\s+\|wl_device_comm\|\s+No resolver found for id: (\d{1,4}) response: \{"error":\{"code":404,"message":"Method not found"\},"id":(\d{1,4}),"method":"v\.oai\.rgbcfg"\}\s*$/

function trafficResult(status = 'not_observed', observedAt = null, fresh = false) {
  return { status, observedAt, fresh }
}

function result(status, profileIndex = null, layerIndex = null, observedAt = null, fresh = false, codexProtocolTraffic = trafficResult()) {
  return { status, profileIndex, layerIndex, observedAt, fresh, codexProtocolTraffic }
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
  const codexResponses = []
  for (const line of text.split('\n')) {
    const match = MISMATCH_PATTERN.exec(line)
    if (match) {
      const profileIndex = Number(match[8])
      const layerIndex = Number(match[9])
      const timestamp = timestampFrom(match)
      if (profileIndex <= MAX_PROFILE_INDEX && layerIndex <= MAX_LAYER_INDEX && timestamp && (!latest || timestamp > latest.timestamp)) {
        latest = { profileIndex, layerIndex, timestamp }
      }
    }

    const response = CODEX_RESPONSE_PATTERN.exec(line)
    if (!response || response[8] !== response[9]) continue
    const timestamp = timestampFrom(response)
    if (timestamp) codexResponses.push(timestamp)
  }

  codexResponses.sort((left, right) => left - right)
  let recurringResponse = null
  for (let index = 1; index < codexResponses.length; index += 1) {
    const gap = codexResponses[index].getTime() - codexResponses[index - 1].getTime()
    if (gap > 0 && gap <= CODEX_TRAFFIC_RECURRENCE_MS) recurringResponse = codexResponses[index]
  }
  const codexProtocolTraffic = recurringResponse
    ? trafficResult(
      'recurring_unresolved_response',
      recurringResponse.toISOString(),
      now.getTime() - recurringResponse.getTime() >= -60_000
        && now.getTime() - recurringResponse.getTime() <= CODEX_TRAFFIC_FRESHNESS_MS,
    )
    : trafficResult()

  if (!latest) return result('not_observed', null, null, null, false, codexProtocolTraffic)
  const age = now.getTime() - latest.timestamp.getTime()
  return result(
    'unresolved_profile_layer',
    latest.profileIndex,
    latest.layerIndex,
    latest.timestamp.toISOString(),
    age >= -60_000 && age <= FRESHNESS_MS,
    codexProtocolTraffic,
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
    if (pathHasSymlink(home, filePath)) return result('log_unsafe', null, null, null, false, trafficResult('log_unsafe'))
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile()) return result('log_unsafe', null, null, null, false, trafficResult('log_unsafe'))
    const bytes = Math.min(stats.size, MAX_LOG_TAIL_BYTES)
    if (bytes === 0) return result('not_observed')
    const buffer = Buffer.alloc(bytes)
    readSync(descriptor, buffer, 0, bytes, Math.max(0, stats.size - bytes))
    let text = buffer.toString('utf8')
    if (stats.size > bytes) text = text.slice(Math.max(0, text.indexOf('\n') + 1))
    return classifyInputRuntimeLog(text, now)
  } catch (error) {
    const status = error?.code === 'ENOENT' ? 'log_missing' : 'log_unavailable'
    return result(status, null, null, null, false, trafficResult(status))
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

module.exports = {
  CODEX_TRAFFIC_FRESHNESS_MS,
  CODEX_TRAFFIC_RECURRENCE_MS,
  FRESHNESS_MS,
  MAX_LAYER_INDEX,
  MAX_LOG_TAIL_BYTES,
  MAX_PROFILE_INDEX,
  classifyInputRuntimeLog,
  inspectInputRuntime,
}
