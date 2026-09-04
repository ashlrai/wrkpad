const MAX_SIGNAL_IDS = 64
const MAX_TOTAL_OBSERVED = Number.MAX_SAFE_INTEGER
const MAX_PUBLIC_FLIGHT_EVENTS = 100

function validSignalIds(signalIds) {
  return Array.isArray(signalIds)
    && signalIds.length > 0
    && signalIds.length <= MAX_SIGNAL_IDS
    && new Set(signalIds).size === signalIds.length
    && signalIds.every((signalId) => typeof signalId === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(signalId))
}

function observedAt(now) {
  try {
    const value = now()
    const date = value instanceof Date ? value : new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  } catch {
    return null
  }
}

/**
 * Records only an allowlisted control ID, timestamp, aggregate count, and the
 * route-delivery decision. No key text, process data, paths, or user content
 * enter this diagnostic receipt. A new observation defaults to rejected so an
 * exception between the OS callback and the route guard cannot look allowed.
 */
function createShortcutObservability({ signalIds, now = () => new Date() } = {}) {
  if (!validSignalIds(signalIds) || typeof now !== 'function') {
    throw new TypeError('A bounded shortcut signal allowlist and clock are required')
  }
  const allowed = new Set(signalIds)
  let totalObserved = 0
  let last = null
  let lastToken = null
  let generation = 0
  let scope = 'unowned'

  function beginGeneration(nextScope, force = false) {
    if (typeof nextScope !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(nextScope)) return false
    if (!force && scope === nextScope) return false
    generation = Math.min(MAX_TOTAL_OBSERVED, generation + 1)
    scope = nextScope
    totalObserved = 0
    last = null
    lastToken = null
    return true
  }

  function observe(signalId) {
    if (!allowed.has(signalId)) return null
    const receivedAt = observedAt(now)
    if (!receivedAt) return null
    const token = Symbol('shortcut-observation')
    totalObserved = Math.min(MAX_TOTAL_OBSERVED, totalObserved + 1)
    last = { signalId, receivedAt, outcome: 'rejected' }
    lastToken = token
    return Object.freeze({ token, signalId, receivedAt })
  }

  function allow(observation) {
    if (!observation || observation.token !== lastToken || last?.signalId !== observation.signalId || last?.receivedAt !== observation.receivedAt) return false
    last = { ...last, outcome: 'allowed' }
    return true
  }

  function snapshot() {
    return {
      generation,
      scope,
      totalObserved,
      last: last ? { ...last } : null,
    }
  }

  return Object.freeze({ allow, beginGeneration, observe, snapshot })
}

function projectFlightSnapshot(snapshot, hotkeys) {
  const active = snapshot?.active === true
  const startedAt = active && typeof snapshot?.startedAt === 'string' && Number.isFinite(Date.parse(snapshot.startedAt))
    ? new Date(snapshot.startedAt).toISOString()
    : null
  const rawEvents = Array.isArray(snapshot?.rawEvents) ? snapshot.rawEvents : []
  const allowlistedHotkeys = hotkeys && typeof hotkeys === 'object' ? hotkeys : {}
  return {
    active,
    startedAt,
    invalidated: snapshot?.invalidated === true,
    droppedEventCount: Number.isSafeInteger(snapshot?.droppedEventCount) && snapshot.droppedEventCount >= 0 ? snapshot.droppedEventCount : 0,
    rawEvents: rawEvents.slice(-MAX_PUBLIC_FLIGHT_EVENTS).flatMap((event) => {
      const accelerator = allowlistedHotkeys[event?.signalId]
      if (typeof accelerator !== 'string'
        || event?.schemaVersion !== 1
        || event?.source !== 'global-shortcut'
        || event?.accelerator !== accelerator
        || !Number.isSafeInteger(event?.sequence)
        || event.sequence < 1
        || typeof event?.receivedAt !== 'string'
        || !Number.isFinite(Date.parse(event.receivedAt))
        || typeof event?.monotonicNs !== 'string'
        || !/^\d{1,32}$/.test(event.monotonicNs)) return []
      return [{
        schemaVersion: 1,
        sequence: event.sequence,
        signalId: event.signalId,
        source: 'global-shortcut',
        accelerator,
        receivedAt: new Date(event.receivedAt).toISOString(),
        monotonicNs: event.monotonicNs,
      }]
    }),
  }
}

module.exports = {
  MAX_PUBLIC_FLIGHT_EVENTS,
  MAX_SIGNAL_IDS,
  MAX_TOTAL_OBSERVED,
  createShortcutObservability,
  projectFlightSnapshot,
}
