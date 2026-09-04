const { createFlightInterlock } = require('./flight-interlock.cjs')

function createFlightSession(now = () => new Date().toISOString()) {
  const interlock = createFlightInterlock()
  let rawEvents = []
  let startedAt = null
  let invalidated = false
  let droppedEventCount = 0

  const clear = () => {
    interlock.set(false)
    rawEvents = []
    startedAt = null
    invalidated = false
    droppedEventCount = 0
  }

  return {
    start() {
      rawEvents = []
      startedAt = now()
      invalidated = false
      droppedEventCount = 0
      interlock.set(true)
      return this.snapshot()
    },
    restart() {
      if (!interlock.isActive()) return this.snapshot()
      rawEvents = []
      startedAt = now()
      invalidated = false
      droppedEventCount = 0
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
    invalidate() {
      if (!interlock.isActive()) return false
      invalidated = true
      return true
    },
    snapshot() {
      return { active: interlock.isActive(), startedAt, invalidated, droppedEventCount, rawEvents: [...rawEvents] }
    },
  }
}

module.exports = { createFlightSession }
