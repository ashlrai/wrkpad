const path = require('node:path')
const { performance } = require('node:perf_hooks')
const { Worker } = require('node:worker_threads')
const { TOTAL_PROBE_BUDGET_MS } = require('./input-installation-diagnostics.cjs')

const CACHE_TTL_MS = 30_000
const MAX_HOME_LENGTH = 4_096
// The Electron main thread never performs the synchronous trust walk. Give the
// worker only a small delivery/termination margin beyond the core deadline.
const WORKER_SHUTDOWN_GRACE_MS = 1_000
const WORKER_TIMEOUT_MS = TOTAL_PROBE_BUDGET_MS + WORKER_SHUTDOWN_GRACE_MS
const WORKER_ENTRY_PATH = path.join(__dirname, 'input-installation-worker-entry.cjs')
const STATUSES = new Set([
  'gatekeeper_rejected',
  'invalid_metadata',
  'invalid_signature',
  'known_resource_mutation',
  'missing',
  'multiple_installations',
  'probe_unavailable',
  'publisher_unrecognized',
  'unsafe',
  'verified',
])
const STATUSES_WITH_VERSION = new Set([
  'gatekeeper_rejected',
  'invalid_signature',
  'known_resource_mutation',
  'publisher_unrecognized',
  'verified',
])

function unavailable() {
  return Object.freeze({ status: 'probe_unavailable', version: null })
}

function validHome(home) {
  return typeof home === 'string'
    && home.length > 0
    && home.length <= MAX_HOME_LENGTH
    && path.isAbsolute(home)
    && !home.includes('\0')
}

function sanitizeInspection(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable()
    if (Object.keys(value).sort().join(',') !== 'status,version') return unavailable()
    if (!STATUSES.has(value.status)) return unavailable()
    const version = value.version
    const versionIsValid = typeof version === 'string' && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,63}$/u.test(version)
    if (STATUSES_WITH_VERSION.has(value.status) ? !versionIsValid : version !== null) return unavailable()
    return Object.freeze({ status: value.status, version })
  } catch {
    return unavailable()
  }
}

function safelyTerminate(worker) {
  try {
    const termination = worker.terminate()
    if (termination && typeof termination.catch === 'function') termination.catch(() => {})
  } catch {
    // Termination is best-effort after the bounded result has already failed closed.
  }
}

function createInputInstallationInspector(options = {}) {
  const workerFactory = options.workerFactory ?? ((filename, workerOptions) => new Worker(filename, workerOptions))
  const clock = options.clock ?? (() => performance.now())
  const workerTimeoutMs = Number.isFinite(options.workerTimeoutMs) && options.workerTimeoutMs > 0
    ? Math.min(options.workerTimeoutMs, WORKER_TIMEOUT_MS)
    : WORKER_TIMEOUT_MS
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs >= 0
    ? Math.min(options.cacheTtlMs, CACHE_TTL_MS)
    : CACHE_TTL_MS
  let cache = null
  let cacheAt = null
  let cacheHome = null
  let inFlight = null
  let inFlightHome = null

  function now() {
    try {
      const value = clock()
      return Number.isFinite(value) ? value : null
    } catch {
      return null
    }
  }

  function runWorker(home) {
    if (!validHome(home) || typeof workerFactory !== 'function') return Promise.resolve(unavailable())
    return new Promise((resolve) => {
      let worker
      let timer = null
      let settled = false
      const finish = (value, terminate = false) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        if (terminate && worker) safelyTerminate(worker)
        resolve(sanitizeInspection(value))
      }
      try {
        worker = workerFactory(WORKER_ENTRY_PATH, {
          workerData: { schemaVersion: 1, home },
        })
      } catch {
        finish(unavailable())
        return
      }
      if (!worker || typeof worker.once !== 'function' || typeof worker.terminate !== 'function') {
        finish(unavailable(), true)
        return
      }
      try {
        worker.once('message', (value) => finish(value, true))
        worker.once('error', () => finish(unavailable(), true))
        worker.once('exit', (code) => {
          if (!settled) finish(unavailable(), code !== 0)
        })
        timer = setTimeout(() => finish(unavailable(), true), workerTimeoutMs)
      } catch {
        finish(unavailable(), true)
      }
    })
  }

  return function inspectInputInstallationAsync({ home, force = false } = {}) {
    if (!validHome(home)) return Promise.resolve(unavailable())
    const observedAt = now()
    if (
      !force
      && cache
      && cacheHome === home
      && observedAt !== null
      && cacheAt !== null
      && observedAt >= cacheAt
      && observedAt - cacheAt < cacheTtlMs
    ) return Promise.resolve(cache)
    if (inFlight) return inFlightHome === home ? inFlight : Promise.resolve(unavailable())

    inFlightHome = home
    inFlight = runWorker(home).then((inspection) => {
      cache = inspection
      cacheHome = home
      cacheAt = now()
      return inspection
    }).finally(() => {
      inFlight = null
      inFlightHome = null
    })
    return inFlight
  }
}

module.exports = {
  CACHE_TTL_MS,
  WORKER_ENTRY_PATH,
  WORKER_SHUTDOWN_GRACE_MS,
  WORKER_TIMEOUT_MS,
  createInputInstallationInspector,
  sanitizeInspection,
}
