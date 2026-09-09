const { createFlightInterlock } = require('./flight-interlock.cjs')

function createFlightSession(now = () => new Date().toISOString()) {
  const interlock = createFlightInterlock()
  let rawEvents = []
  let suppressedDuplicateEvents = []
  let startedAt = null
  let invalidated = false
  let droppedEventCount = 0
  let droppedSuppressedDuplicateCount = 0

  const clear = () => {
    interlock.set(false)
    rawEvents = []
    suppressedDuplicateEvents = []
    startedAt = null
    invalidated = false
    droppedEventCount = 0
    droppedSuppressedDuplicateCount = 0
  }

  return {
    start() {
      rawEvents = []
      suppressedDuplicateEvents = []
      startedAt = now()
      invalidated = false
      droppedEventCount = 0
      droppedSuppressedDuplicateCount = 0
      interlock.set(true)
      return this.snapshot()
    },
    restart() {
      if (!interlock.isActive()) return this.snapshot()
      rawEvents = []
      suppressedDuplicateEvents = []
      startedAt = now()
      invalidated = false
      droppedEventCount = 0
      droppedSuppressedDuplicateCount = 0
      return this.snapshot()
    },
    stop() {
      clear()
      return this.snapshot()
    },
    reset() { clear() },
    isActive() { return interlock.isActive() },
    record(event) {
      if (!interlock.isActive()) return false
      if (rawEvents.length >= 500) {
        invalidated = true
        droppedEventCount = Math.min(Number.MAX_SAFE_INTEGER, droppedEventCount + 1)
      }
      rawEvents = [...rawEvents.slice(-499), event]
      return true
    },
    recordSuppressedDuplicate(event) {
      if (!interlock.isActive()) return false
      if (suppressedDuplicateEvents.length >= 100) {
        invalidated = true
        droppedSuppressedDuplicateCount = Math.min(Number.MAX_SAFE_INTEGER, droppedSuppressedDuplicateCount + 1)
      }
      suppressedDuplicateEvents = [...suppressedDuplicateEvents.slice(-99), event]
      return true
    },
    invalidate() {
      if (!interlock.isActive()) return false
      invalidated = true
      return true
    },
    snapshot() {
      return {
        active: interlock.isActive(), startedAt, invalidated, droppedEventCount,
        droppedSuppressedDuplicateCount,
        rawEvents: [...rawEvents],
        suppressedDuplicateEvents: suppressedDuplicateEvents.map((event) => ({ ...event })),
      }
    },
  }
}

module.exports = { createFlightSession }
