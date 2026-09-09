const { isDeepStrictEqual } = require('node:util')
const {
  advanceCommissioningJournal,
  createCommissioningJournal,
  sanitizeCommissioningJournal,
} = require('./commissioning-journal.cjs')
const { createCommissioningPlan, evaluateCommissioningPlan } = require('./commissioning-plan.cjs')
const { commissioningSnapshotSha256, sanitizeCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

const OBSERVED_MESSAGE = 'Read-only commissioning state observed. No configuration was changed.'
const PREPARED_MESSAGE = 'Read-only commissioning plan prepared. Work Louder Input and the board were not changed.'
const EVIDENCE_MESSAGE = 'Commissioning evidence could not be collected safely. No configuration was changed.'
const DRIFT_MESSAGE = 'Commissioning evidence changed between probes. No plan was saved and no configuration was changed.'
const PLAN_MESSAGE = 'A commissioning plan could not be saved safely. No configuration was changed.'

function assertDependencies(options) {
  for (const name of ['collectSnapshot', 'readJournal', 'writeJournal']) {
    if (typeof options?.[name] !== 'function') throw new TypeError(`${name} must be a function`)
  }
  if (options.now !== undefined && typeof options.now !== 'function') throw new TypeError('now must be a function')
}

function normalizedNow(options) {
  const supplied = options.now ? options.now() : new Date()
  const current = supplied instanceof Date ? new Date(supplied.getTime()) : new Date(supplied)
  if (!Number.isFinite(current.getTime())) throw new TypeError('commissioning clock is invalid')
  return current.toISOString()
}

function readCurrentJournal(options) {
  const journal = options.readJournal()
  if (journal && typeof journal.then === 'function') throw new TypeError('readJournal must be synchronous')
  if (journal === null) return null
  const sanitized = sanitizeCommissioningJournal(journal)
  if (!sanitized) throw new TypeError('commissioning journal is invalid')
  return sanitized
}

function failure(code, message, snapshot = null, journal = null) {
  return {
    ok: false,
    code,
    message,
    snapshot,
    plan: null,
    journalRevision: journal?.revision ?? null,
  }
}

function createCommissioningOperationCoordinator(options) {
  assertDependencies(options)
  let operationTail = Promise.resolve()

  function enqueue(operation) {
    const result = operationTail.then(operation, operation)
    operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async function collect() {
    const value = await options.collectSnapshot()
    const snapshot = sanitizeCommissioningSnapshot(value)
    if (!snapshot) throw new TypeError('commissioning snapshot is invalid')
    return snapshot
  }

  async function getOperation() {
    try {
      const snapshot = await collect()
      const journal = readCurrentJournal(options)
      const now = normalizedNow(options)
      const plan = journal && evaluateCommissioningPlan(journal.plan, snapshot, now).status === 'current'
        ? journal.plan
        : null
      return {
        ok: true,
        code: 'observed',
        message: OBSERVED_MESSAGE,
        snapshot,
        plan,
        journalRevision: journal?.revision ?? null,
      }
    } catch {
      return failure('evidence_unavailable', EVIDENCE_MESSAGE)
    }
  }

  async function prepareOperation() {
    let latest = null
    let journal = null
    try {
      const initial = await collect()
      latest = await collect()
      journal = readCurrentJournal(options)
      if (commissioningSnapshotSha256(initial) !== commissioningSnapshotSha256(latest)) {
        return failure('evidence_drift', DRIFT_MESSAGE, latest, journal)
      }

      const now = normalizedNow(options)
      const plan = createCommissioningPlan(latest, { createdAt: now })
      const next = journal
        ? advanceCommissioningJournal(journal, latest, plan, now)
        : createCommissioningJournal(latest, plan, now)
      const writtenValue = await options.writeJournal(next, journal?.revision ?? null)
      const written = sanitizeCommissioningJournal(writtenValue)
      if (!written || !isDeepStrictEqual(written, next)) throw new TypeError('commissioning journal verification failed')
      const persisted = readCurrentJournal(options)
      if (!persisted || !isDeepStrictEqual(persisted, written)) throw new TypeError('commissioning journal persistence changed')
      return {
        ok: true,
        code: 'plan_prepared',
        message: PREPARED_MESSAGE,
        snapshot: latest,
        plan,
        journalRevision: written.revision,
      }
    } catch {
      return failure('plan_unavailable', PLAN_MESSAGE, latest, journal)
    }
  }

  return Object.freeze({
    get: () => enqueue(getOperation),
    prepare: () => enqueue(prepareOperation),
  })
}

module.exports = {
  createCommissioningOperationCoordinator,
}
