const TARGET_SIGNAL_ID = 'joyRight'
const TARGET_ACCELERATOR = 'Control+Alt+Command+Right'
const TARGET_ROUTE = 'ashlr_layer'
const SOURCES = new Set(['physical', 'synthetic'])
const CALLBACK_OUTCOMES = new Set(['allowed', 'rejected', 'silent'])
const MAPPED_RESULTS = new Set(['succeeded', 'missing', 'pending'])
const INSTRUCTED_INPUTS = new Set(['mac_keyboard', 'creator_micro_2'])
const PROBE_TIMEOUT_MS = 10_000

function validOwnership(value) {
  return value
    && Number.isSafeInteger(value.generation)
    && value.generation >= 0
    && Number.isSafeInteger(value.totalObserved)
    && value.totalObserved >= 0
    && typeof value.scope === 'string'
    && /^[a-z][a-z0-9_]{0,31}$/.test(value.scope)
}

function emptyAttempts() {
  return { physical: null, synthetic: null }
}

function copyAttempt(value) {
  return value ? { ...value } : null
}

function createTargetedShortcutDiagnostic() {
  let ownership = null
  let baselineObserved = null
  let attempts = emptyAttempts()

  function start(nextOwnership) {
    if (!validOwnership(nextOwnership)) return false
    ownership = {
      generation: nextOwnership.generation,
      totalObserved: nextOwnership.totalObserved,
      scope: nextOwnership.scope,
    }
    baselineObserved = nextOwnership.totalObserved
    attempts = emptyAttempts()
    return true
  }

  function updateOwnership(nextOwnership) {
    if (!validOwnership(nextOwnership)) return false
    if (!ownership || nextOwnership.generation !== ownership.generation) return start(nextOwnership)
    if (nextOwnership.totalObserved < ownership.totalObserved) return false
    ownership = {
      generation: nextOwnership.generation,
      totalObserved: nextOwnership.totalObserved,
      scope: nextOwnership.scope,
    }
    return true
  }

  function attestAttempt(attestation) {
    if (!ownership
      || !attestation
      || attestation.generation !== ownership.generation
      || !SOURCES.has(attestation.source)
      || !CALLBACK_OUTCOMES.has(attestation.callback)
      || !MAPPED_RESULTS.has(attestation.mappedResult)) return false

    const callbackObserved = attestation.callback !== 'silent'
    if (callbackObserved) {
      if (attestation.signalId !== TARGET_SIGNAL_ID || attestation.accelerator !== TARGET_ACCELERATOR) return false
      if (ownership.totalObserved <= baselineObserved) return false
    } else if (attestation.mappedResult !== 'pending') {
      return false
    }

    if (attestation.callback !== 'allowed' && attestation.mappedResult !== 'pending') return false

    attempts = {
      ...attempts,
      [attestation.source]: {
        source: attestation.source,
        evidence: 'caller_attestation',
        callback: attestation.callback,
        mappedResult: attestation.mappedResult,
        signalId: callbackObserved ? TARGET_SIGNAL_ID : null,
        accelerator: callbackObserved ? TARGET_ACCELERATOR : null,
        ownershipObservedCount: ownership.totalObserved,
      },
    }
    return true
  }

  function outcome() {
    if (!ownership) return 'pending'
    if (ownership.scope !== TARGET_ROUTE) return 'rejected_route'

    const current = Object.values(attempts).filter(Boolean)
    if (current.some((attempt) => attempt.callback === 'rejected')) return 'rejected_route'
    if (current.some((attempt) => attempt.callback === 'allowed' && attempt.mappedResult === 'succeeded')) return 'working'
    if (current.some((attempt) => attempt.callback === 'allowed' && attempt.mappedResult === 'missing')) return 'app_dispatch_failure'

    const physical = attempts.physical
    const synthetic = attempts.synthetic
    if (physical?.callback === 'silent' && synthetic?.callback === 'allowed') return 'physical_emission_failure'
    if (physical?.callback === 'silent' && synthetic?.callback === 'silent') return 'receiver_or_permission_failure'
    return 'pending'
  }

  function snapshot() {
    return {
      target: { signalId: TARGET_SIGNAL_ID, accelerator: TARGET_ACCELERATOR, route: TARGET_ROUTE },
      ownership: ownership
        ? {
            generation: ownership.generation,
            baselineObservedCount: baselineObserved,
            observedCount: ownership.totalObserved,
            observedDelta: ownership.totalObserved - baselineObserved,
            scope: ownership.scope,
          }
        : null,
      attempts: {
        physical: copyAttempt(attempts.physical),
        synthetic: copyAttempt(attempts.synthetic),
      },
      outcome: outcome(),
      deviceIdentityClaimed: false,
    }
  }

  function reset() {
    ownership = null
    baselineObserved = null
    attempts = emptyAttempts()
  }

  return Object.freeze({ attestAttempt, reset, snapshot, start, updateOwnership })
}

function createTargetedShortcutProbeCoordinator({
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) {
  if (typeof now !== 'function' || typeof setTimer !== 'function' || typeof clearTimer !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
    throw new TypeError('A bounded diagnostic clock and timer are required')
  }
  let pending = null

  function timestamp() {
    try {
      const value = now()
      const parsed = value instanceof Date ? value : new Date(value)
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
    } catch {
      return null
    }
  }

  function resultFor(run, status, observedAt = null) {
    return Object.freeze({
      schemaVersion: 1,
      target: TARGET_SIGNAL_ID,
      instructedInput: run.instructedInput,
      status,
      generation: run.generation,
      startedAt: run.startedAt,
      observedAt,
      delivery: status === 'os_callback_observed' ? 'allowed' : 'none',
    })
  }

  function settle(status, observedAt = null) {
    const run = pending
    if (!run) return false
    pending = null
    clearTimer(run.timer)
    run.resolve(resultFor(run, status, observedAt))
    return true
  }

  function start({ instructedInput, ownership, eligible = true } = {}) {
    if (!INSTRUCTED_INPUTS.has(instructedInput) || !validOwnership(ownership)) {
      return Promise.resolve(Object.freeze({
        schemaVersion: 1,
        target: TARGET_SIGNAL_ID,
        instructedInput: INSTRUCTED_INPUTS.has(instructedInput) ? instructedInput : 'mac_keyboard',
        status: 'blocked',
        generation: validOwnership(ownership) ? ownership.generation : 0,
        startedAt: timestamp(),
        observedAt: null,
        delivery: 'none',
      }))
    }
    if (pending) settle('superseded')
    const startedAt = timestamp()
    if (!eligible || ownership.scope !== TARGET_ROUTE || !startedAt) {
      return Promise.resolve(resultFor({ instructedInput, generation: ownership.generation, startedAt }, 'blocked'))
    }
    return new Promise((resolve) => {
      const run = { instructedInput, generation: ownership.generation, startedAt, resolve, timer: null }
      pending = run
      run.timer = setTimer(() => {
        if (pending === run) settle('timed_out')
      }, timeoutMs)
    })
  }

  function observe({ signalId, generation, scope, observedAt } = {}) {
    if (!pending || signalId !== TARGET_SIGNAL_ID || scope !== TARGET_ROUTE
      || generation !== pending.generation || typeof observedAt !== 'string'
      || !Number.isFinite(Date.parse(observedAt))) return false
    return settle('os_callback_observed', new Date(observedAt).toISOString())
  }

  function invalidate() {
    return settle('invalidated')
  }

  function active() {
    return pending !== null
  }

  return Object.freeze({ active, invalidate, observe, start })
}

module.exports = {
  TARGET_ACCELERATOR,
  TARGET_ROUTE,
  TARGET_SIGNAL_ID,
  PROBE_TIMEOUT_MS,
  createTargetedShortcutDiagnostic,
  createTargetedShortcutProbeCoordinator,
}
