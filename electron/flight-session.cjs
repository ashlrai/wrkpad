const { createFlightInterlock } = require('./flight-interlock.cjs')

function createFlightSession(now = () => new Date().toISOString()) {
  const interlock = createFlightInterlock()
  let rawEvents = []
  let startedAt = null

  const clear = () => {
    interlock.set(false)
    rawEvents = []
    startedAt = null
  }

  return {
    start() {
      rawEvents = []
      startedAt = now()
      interlock.set(true)
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
      rawEvents = [...rawEvents.slice(-499), event]
      return true
    },
    snapshot() {
      return { active: interlock.isActive(), startedAt, rawEvents: [...rawEvents] }
    },
  }
}

module.exports = { createFlightSession }
