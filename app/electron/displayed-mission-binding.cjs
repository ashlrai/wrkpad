const SURFACES = new Set(['main', 'compact'])

function createDisplayedMissionBinding() {
  const snapshots = new Map()
  return Object.freeze({
    publish(surface, snapshot) {
      if (!SURFACES.has(surface) || !snapshot || !Array.isArray(snapshot.agents)) throw new TypeError('A valid displayed mission surface and snapshot are required')
      snapshots.set(surface, snapshot)
      return snapshot
    },
    read(surface) {
      return SURFACES.has(surface) ? snapshots.get(surface) ?? null : null
    },
    clear(surface) {
      if (SURFACES.has(surface)) snapshots.delete(surface)
    },
  })
}

module.exports = { createDisplayedMissionBinding }
