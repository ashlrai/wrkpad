const {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { isDeepStrictEqual } = require('node:util')
const { evaluateCommissioningPlan, sanitizeCommissioningPlan } = require('./commissioning-plan.cjs')
const { commissioningSnapshotSha256, sanitizeCommissioningSnapshot } = require('./commissioning-snapshot.cjs')

const COMMISSIONING_JOURNAL_SCHEMA = 'ai.ashlr.agent-board.commissioning-journal/v1'
const COMMISSIONING_DIRECTORY = 'commissioning'
const COMMISSIONING_JOURNAL_FILENAME = 'journal.json'
const COMMISSIONING_LOCK_FILENAME = '.journal.lock'
const MAX_COMMISSIONING_JOURNAL_BYTES = 64 * 1024
const MAX_COMMISSIONING_EVENTS = 32
const MAX_LOCAL_PATH_LENGTH = 4096
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const OUTCOMES = new Set(['ready', 'manual_export_required', 'blocked', 'already_configured'])

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function validIsoTimestamp(value) {
  if (typeof value !== 'string' || value.length !== 24) return false
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function hasUnsafeText(value) {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f
      || (codePoint >= 0x7f && codePoint <= 0x9f)
      || (codePoint >= 0x202a && codePoint <= 0x202e)
      || (codePoint >= 0x2066 && codePoint <= 0x2069)
  })
}

function validSettingsFilePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_LOCAL_PATH_LENGTH
    && path.isAbsolute(value)
    && !hasUnsafeText(value)
}

function sanitizeEvent(value) {
  if (!exactKeys(value, ['at', 'planId', 'outcome', 'snapshotSha256'])) return null
  if (!validIsoTimestamp(value.at) || !SHA256_PATTERN.test(value.planId ?? '')
    || !OUTCOMES.has(value.outcome) || !SHA256_PATTERN.test(value.snapshotSha256 ?? '')) return null
  return { at: value.at, planId: value.planId, outcome: value.outcome, snapshotSha256: value.snapshotSha256 }
}

function sanitizeCommissioningJournal(value) {
  if (!exactKeys(value, ['schema', 'revision', 'updatedAt', 'snapshot', 'plan', 'events'])) return null
  if (value.schema !== COMMISSIONING_JOURNAL_SCHEMA || !Number.isSafeInteger(value.revision)
    || value.revision < 1 || !validIsoTimestamp(value.updatedAt)) return null
  const snapshot = sanitizeCommissioningSnapshot(value.snapshot)
  const plan = sanitizeCommissioningPlan(value.plan)
  if (!snapshot || !plan || !Array.isArray(value.events)
    || value.events.length < 1 || value.events.length > MAX_COMMISSIONING_EVENTS) return null
  if (evaluateCommissioningPlan(plan, snapshot, plan.createdAt).status !== 'current') return null
  if (Date.parse(value.updatedAt) < Date.parse(plan.createdAt)) return null
  const events = value.events.map(sanitizeEvent)
  if (events.some((event) => !event)) return null
  for (let index = 1; index < events.length; index += 1) {
    if (Date.parse(events[index].at) < Date.parse(events[index - 1].at)) return null
  }
  const currentEvent = events.at(-1)
  if (currentEvent.at !== value.updatedAt || currentEvent.planId !== plan.id
    || currentEvent.outcome !== plan.outcome
    || currentEvent.snapshotSha256 !== commissioningSnapshotSha256(snapshot)) return null
  return {
    schema: COMMISSIONING_JOURNAL_SCHEMA,
    revision: value.revision,
    updatedAt: value.updatedAt,
    snapshot,
    plan,
    events,
  }
}

function eventFor(snapshot, plan, at) {
  return {
    at,
    planId: plan.id,
    outcome: plan.outcome,
    snapshotSha256: commissioningSnapshotSha256(snapshot),
  }
}

function createCommissioningJournal(snapshotValue, planValue, updatedAt = new Date().toISOString()) {
  const snapshot = sanitizeCommissioningSnapshot(snapshotValue)
  const plan = sanitizeCommissioningPlan(planValue)
  if (!snapshot || !plan || !validIsoTimestamp(updatedAt)) throw new TypeError('commissioning journal inputs are invalid')
  const journal = sanitizeCommissioningJournal({
    schema: COMMISSIONING_JOURNAL_SCHEMA,
    revision: 1,
    updatedAt,
    snapshot,
    plan,
    events: [eventFor(snapshot, plan, updatedAt)],
  })
  if (!journal) throw new TypeError('commissioning journal is invalid')
  return journal
}

function advanceCommissioningJournal(previousValue, snapshotValue, planValue, updatedAt = new Date().toISOString()) {
  const previous = sanitizeCommissioningJournal(previousValue)
  const snapshot = sanitizeCommissioningSnapshot(snapshotValue)
  const plan = sanitizeCommissioningPlan(planValue)
  if (!previous || !snapshot || !plan || !validIsoTimestamp(updatedAt)
    || Date.parse(updatedAt) < Date.parse(previous.updatedAt)) throw new TypeError('commissioning journal advance is invalid')
  const events = [...previous.events, eventFor(snapshot, plan, updatedAt)].slice(-MAX_COMMISSIONING_EVENTS)
  const journal = sanitizeCommissioningJournal({
    schema: COMMISSIONING_JOURNAL_SCHEMA,
    revision: previous.revision + 1,
    updatedAt,
    snapshot,
    plan,
    events,
  })
  if (!journal) throw new TypeError('commissioning journal advance is invalid')
  return journal
}

function commissioningJournalPath(settingsFilePath) {
  if (!validSettingsFilePath(settingsFilePath)) throw new TypeError('settingsFilePath must be an absolute local path')
  return path.join(path.dirname(settingsFilePath), COMMISSIONING_DIRECTORY, COMMISSIONING_JOURNAL_FILENAME)
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function inspectCommissioningJournalFile(filePath) {
  let descriptor
  try {
    const pathStats = lstatSync(filePath)
    if (pathStats.isSymbolicLink() || !pathStats.isFile() || (pathStats.mode & 0o077) !== 0
      || pathStats.size < 2 || pathStats.size > MAX_COMMISSIONING_JOURNAL_BYTES) {
      return { status: 'invalid', journal: null }
    }
    descriptor = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const stats = fstatSync(descriptor)
    if (!stats.isFile() || !sameFileIdentity(stats, pathStats) || stats.size !== pathStats.size
      || (stats.mode & 0o077) !== 0) return { status: 'invalid', journal: null }
    const journal = sanitizeCommissioningJournal(JSON.parse(readFileSync(descriptor, 'utf8')))
    return journal ? { status: 'valid', journal } : { status: 'invalid', journal: null }
  } catch (error) {
    return error?.code === 'ENOENT'
      ? { status: 'absent', journal: null }
      : { status: 'invalid', journal: null }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function inspectCommissioningJournal(settingsFilePath) {
  return inspectCommissioningJournalFile(commissioningJournalPath(settingsFilePath))
}

function readCommissioningJournal(settingsFilePath) {
  return inspectCommissioningJournal(settingsFilePath).journal
}

function ensurePrivateDirectory(settingsFilePath) {
  const parent = path.dirname(settingsFilePath)
  const parentStats = lstatSync(parent)
  if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) throw new TypeError('commissioning settings directory is unsafe')
  const directory = path.join(parent, COMMISSIONING_DIRECTORY)
  try {
    const existing = lstatSync(directory)
    if (existing.isSymbolicLink() || !existing.isDirectory()) throw new TypeError('commissioning journal directory is unsafe')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    mkdirSync(directory, { mode: 0o700 })
  }
  chmodSync(directory, 0o700)
  const directoryStats = lstatSync(directory)
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory() || (directoryStats.mode & 0o777) !== 0o700) {
    throw new TypeError('commissioning journal directory is unsafe')
  }
  return { directory, directoryStats }
}

function stateMatchesExpected(state, expectedRevision) {
  if (expectedRevision === null) return state.status === 'absent'
  return state.status === 'valid' && state.journal.revision === expectedRevision
}

function acquireLock(directory, directoryStats) {
  const lockPath = path.join(directory, COMMISSIONING_LOCK_FILENAME)
  const descriptor = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
  try {
    const body = `${JSON.stringify({ pid: process.pid, nonce: randomUUID() })}\n`
    writeFileSync(descriptor, body, { encoding: 'utf8' })
    fsyncSync(descriptor)
    chmodSync(lockPath, 0o600)
    const lockStats = fstatSync(descriptor)
    const currentDirectory = lstatSync(directory)
    const published = lstatSync(lockPath)
    if (!lockStats.isFile() || (lockStats.mode & 0o077) !== 0 || lockStats.size > 256
      || currentDirectory.isSymbolicLink() || !sameFileIdentity(currentDirectory, directoryStats)
      || published.isSymbolicLink() || !published.isFile() || !sameFileIdentity(published, lockStats)) {
      throw new TypeError('commissioning journal lock is unsafe')
    }
    return { descriptor, lockPath, lockStats }
  } catch (error) {
    closeSync(descriptor)
    try { unlinkSync(lockPath) } catch {}
    throw error
  }
}

function withJournalLock(settingsFilePath, operation) {
  const { directory, directoryStats } = ensurePrivateDirectory(settingsFilePath)
  let lock
  try {
    lock = acquireLock(directory, directoryStats)
    return operation({ directory, directoryStats })
  } catch {
    throw new TypeError('commissioning journal is busy or unsafe')
  } finally {
    if (lock) {
      closeSync(lock.descriptor)
      try {
        const current = lstatSync(lock.lockPath)
        if (current.isFile() && sameFileIdentity(current, lock.lockStats)) unlinkSync(lock.lockPath)
      } catch {}
    }
  }
}

function writeCommissioningJournal(settingsFilePath, value, expectedRevision) {
  if (arguments.length < 3) throw new TypeError('expected commissioning journal revision is required')
  if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) {
    throw new TypeError('expected commissioning journal revision is invalid')
  }
  const journal = sanitizeCommissioningJournal(value)
  if (!journal) throw new TypeError('commissioning journal is invalid')
  if (journal.revision !== (expectedRevision === null ? 1 : expectedRevision + 1)) {
    throw new TypeError('commissioning journal revision is not the next CAS revision')
  }
  const serialized = `${JSON.stringify(journal, null, 2)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > MAX_COMMISSIONING_JOURNAL_BYTES) {
    throw new TypeError('commissioning journal is too large')
  }

  const filePath = commissioningJournalPath(settingsFilePath)
  return withJournalLock(settingsFilePath, ({ directory, directoryStats }) => {
    const before = inspectCommissioningJournalFile(filePath)
    if (!stateMatchesExpected(before, expectedRevision)) throw new TypeError('commissioning journal changed')
    const temporaryPath = path.join(directory, `.${COMMISSIONING_JOURNAL_FILENAME}.${randomUUID()}.tmp`)
    let descriptor
    let temporaryExists = false
    try {
      descriptor = openSync(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600)
      temporaryExists = true
      writeFileSync(descriptor, serialized, { encoding: 'utf8' })
      fsyncSync(descriptor)
      chmodSync(temporaryPath, 0o600)
      const temporaryStats = fstatSync(descriptor)
      const currentDirectory = lstatSync(directory)
      if (!temporaryStats.isFile() || temporaryStats.size !== Buffer.byteLength(serialized, 'utf8')
        || (temporaryStats.mode & 0o077) !== 0 || currentDirectory.isSymbolicLink()
        || !sameFileIdentity(currentDirectory, directoryStats)
        || !stateMatchesExpected(inspectCommissioningJournalFile(filePath), expectedRevision)) {
        throw new TypeError('commissioning journal changed')
      }
      closeSync(descriptor)
      descriptor = undefined
      renameSync(temporaryPath, filePath)
      temporaryExists = false
      const written = inspectCommissioningJournalFile(filePath)
      if (written.status !== 'valid' || !isDeepStrictEqual(written.journal, journal)) {
        throw new TypeError('commissioning journal verification failed')
      }
      return written.journal
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
      if (temporaryExists) {
        try { unlinkSync(temporaryPath) } catch {}
      }
    }
  })
}

module.exports = {
  COMMISSIONING_JOURNAL_SCHEMA,
  MAX_COMMISSIONING_EVENTS,
  MAX_COMMISSIONING_JOURNAL_BYTES,
  advanceCommissioningJournal,
  commissioningJournalPath,
  createCommissioningJournal,
  inspectCommissioningJournal,
  readCommissioningJournal,
  sanitizeCommissioningJournal,
  writeCommissioningJournal,
}
