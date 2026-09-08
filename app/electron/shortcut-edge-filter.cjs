const EDGE_DUPLICATE_WINDOW_NS = 35_000_000n

const EDGE_SIGNAL_IDS = Object.freeze([
  'agent1', 'agent2', 'agent3', 'agent4', 'agent5', 'agent6',
  'cmd1', 'cmd2', 'cmd3', 'cmd4', 'cmd5', 'cmd6', 'cmd7',
  'dialPress',
])

const edgeSignalIds = new Set(EDGE_SIGNAL_IDS)

function validFingerprint(value) {
  return value
    && edgeSignalIds.has(value.signalId)
    && typeof value.accelerator === 'string'
    && value.accelerator.length > 0
    && typeof value.route === 'string'
    && value.route.length > 0
    && Number.isSafeInteger(value.generation)
    && value.generation >= 0
}

function sameFingerprint(left, right) {
  return left.signalId === right.signalId
    && left.accelerator === right.accelerator
    && left.route === right.route
    && left.generation === right.generation
}

/**
 * Suppresses the single duplicate callback some edge controls can emit for one
 * physical actuation. Motion callbacks are deliberately never filtered. The
 * window stays anchored to the first delivered edge, so noise cannot extend it.
 * Any ambiguity fails open and remains visible to downstream safety checks.
 */
function createShortcutEdgeDuplicateFilter({
  clock = () => process.hrtime.bigint(),
  windowNs = EDGE_DUPLICATE_WINDOW_NS,
} = {}) {
  if (typeof clock !== 'function' || typeof windowNs !== 'bigint' || windowNs < 0n) {
    throw new TypeError('A monotonic nanosecond clock and non-negative bigint window are required')
  }

  let lastClockNs = null
  let candidate = null

  function reset() {
    lastClockNs = null
    candidate = null
  }

  function inspect(callback) {
    let nowNs
    try {
      nowNs = clock()
    } catch {
      reset()
      return Object.freeze({ suppress: false, observedAtNs: null, deltaNs: null })
    }

    if (typeof nowNs !== 'bigint' || nowNs < 0n) {
      reset()
      return Object.freeze({ suppress: false, observedAtNs: null, deltaNs: null })
    }

    const clockRegressed = lastClockNs !== null && nowNs < lastClockNs
    if (clockRegressed) reset()
    lastClockNs = nowNs

    if (!validFingerprint(callback)) {
      candidate = null
      return Object.freeze({ suppress: false, observedAtNs: nowNs, deltaNs: null })
    }

    if (candidate && sameFingerprint(candidate, callback)) {
      const elapsedNs = nowNs - candidate.startedAtNs
      if (elapsedNs >= 0n && elapsedNs <= windowNs) {
        if (!candidate.suppressedOnce) {
          candidate.suppressedOnce = true
          return Object.freeze({ suppress: true, observedAtNs: nowNs, deltaNs: elapsedNs })
        }
        // Preserve the original deadline and expose the rest of a noisy burst.
        return Object.freeze({ suppress: false, observedAtNs: nowNs, deltaNs: elapsedNs })
      }
    }

    candidate = {
      signalId: callback.signalId,
      accelerator: callback.accelerator,
      route: callback.route,
      generation: callback.generation,
      startedAtNs: nowNs,
      suppressedOnce: false,
    }
    return Object.freeze({ suppress: false, observedAtNs: nowNs, deltaNs: null })
  }

  function shouldSuppress(callback) {
    return inspect(callback).suppress
  }

  return Object.freeze({ inspect, reset, shouldSuppress })
}

module.exports = {
  EDGE_DUPLICATE_WINDOW_NS,
  EDGE_SIGNAL_IDS,
  createShortcutEdgeDuplicateFilter,
}
