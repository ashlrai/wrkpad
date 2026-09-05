const test = require('node:test')
const assert = require('node:assert/strict')
const {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createCommissioningPlan } = require('./commissioning-plan.cjs')
const { createCommissioningSnapshot } = require('./commissioning-snapshot.cjs')
const {
  MAX_COMMISSIONING_EVENTS,
  MAX_COMMISSIONING_JOURNAL_BYTES,
  advanceCommissioningJournal,
  commissioningJournalPath,
  createCommissioningJournal,
  inspectCommissioningJournal,
  readCommissioningJournal,
  sanitizeCommissioningJournal,
  writeCommissioningJournal,
} = require('./commissioning-journal.cjs')

function fixture() {
  const snapshot = createCommissioningSnapshot({
    device: { status: 'exact', vidPid: '303A:8298' },
    input: {
      installation: 'trusted',
      version: '0.18.4',
      running: 'quit',
      cacheStatus: 'candidate',
      inputCacheSha256: 'a'.repeat(64),
    },
    receiver: { status: 'single_trusted', inputMonitoring: 'granted' },
    candidate: { status: 'verified', sha256: 'a'.repeat(64) },
    baseline: { status: 'captured', sha256: 'b'.repeat(64) },
    physicalAcceptance: { status: 'pending', candidateSha256: null, acceptedAt: null },
  }, '2026-09-04T20:00:00.000Z')
  const plan = createCommissioningPlan(snapshot, { createdAt: '2026-09-04T20:01:00.000Z' })
  return { snapshot, plan }
}

function temporarySettings(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-board-commissioning-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return path.join(root, 'settings.json')
}

test('creates, advances, bounds, and validates a privacy-safe journal', () => {
  const { snapshot, plan } = fixture()
  let journal = createCommissioningJournal(snapshot, plan, '2026-09-04T20:01:00.000Z')
  for (let index = 1; index < 40; index += 1) {
    journal = advanceCommissioningJournal(journal, snapshot, plan, new Date(Date.parse('2026-09-04T20:01:00.000Z') + index * 1000).toISOString())
  }
  assert.equal(journal.revision, 40)
  assert.equal(journal.events.length, MAX_COMMISSIONING_EVENTS)
  assert.deepEqual(sanitizeCommissioningJournal(journal), journal)
  assert.doesNotMatch(JSON.stringify(journal), /Users|serial|prompt|transcript|workspace|artifactPath/)
})

test('persists a 0600 journal in a 0700 directory with atomic CAS revisions', (t) => {
  const settingsPath = temporarySettings(t)
  const { snapshot, plan } = fixture()
  const first = createCommissioningJournal(snapshot, plan, '2026-09-04T20:01:00.000Z')
  assert.deepEqual(writeCommissioningJournal(settingsPath, first, null), first)
  const filePath = commissioningJournalPath(settingsPath)
  assert.equal(lstatSync(filePath).mode & 0o777, 0o600)
  assert.equal(lstatSync(path.dirname(filePath)).mode & 0o777, 0o700)
  assert.deepEqual(readCommissioningJournal(settingsPath), first)

  const second = advanceCommissioningJournal(first, snapshot, plan, '2026-09-04T20:02:00.000Z')
  assert.deepEqual(writeCommissioningJournal(settingsPath, second, 1), second)
  assert.equal(readCommissioningJournal(settingsPath).revision, 2)
  assert.throws(() => writeCommissioningJournal(settingsPath, second, 1), /revision|busy|unsafe/)
  assert.equal(readFileSync(filePath, 'utf8').endsWith('\n'), true)
})

test('fails closed on public, oversized, symlinked, non-regular, and held-lock state', (t) => {
  const settingsPath = temporarySettings(t)
  const { snapshot, plan } = fixture()
  const journal = createCommissioningJournal(snapshot, plan, '2026-09-04T20:01:00.000Z')
  writeCommissioningJournal(settingsPath, journal, null)
  const filePath = commissioningJournalPath(settingsPath)

  chmodSync(filePath, 0o644)
  assert.equal(inspectCommissioningJournal(settingsPath).status, 'invalid')
  assert.throws(() => writeCommissioningJournal(settingsPath, journal, null), /busy|unsafe/)

  rmSync(filePath)
  writeFileSync(filePath, 'x'.repeat(MAX_COMMISSIONING_JOURNAL_BYTES + 1), { mode: 0o600 })
  assert.equal(inspectCommissioningJournal(settingsPath).status, 'invalid')

  rmSync(filePath)
  const target = path.join(path.dirname(settingsPath), 'target.json')
  writeFileSync(target, `${JSON.stringify(journal)}\n`, { mode: 0o600 })
  symlinkSync(target, filePath)
  assert.equal(inspectCommissioningJournal(settingsPath).status, 'invalid')

  rmSync(filePath)
  mkdirSync(filePath)
  assert.equal(inspectCommissioningJournal(settingsPath).status, 'invalid')

  rmSync(filePath, { recursive: true })
  const lockPath = path.join(path.dirname(filePath), '.journal.lock')
  writeFileSync(lockPath, 'held\n', { mode: 0o600 })
  assert.throws(() => writeCommissioningJournal(settingsPath, journal, null), /directory is unsafe|busy or unsafe/)
})

test('refuses a symlinked private directory and malformed or non-next revisions', (t) => {
  const settingsPath = temporarySettings(t)
  const { snapshot, plan } = fixture()
  const journal = createCommissioningJournal(snapshot, plan, '2026-09-04T20:01:00.000Z')
  const external = mkdtempSync(path.join(os.tmpdir(), 'agent-board-commissioning-target-'))
  t.after(() => rmSync(external, { recursive: true, force: true }))
  symlinkSync(external, path.join(path.dirname(settingsPath), 'commissioning'))
  assert.throws(() => writeCommissioningJournal(settingsPath, journal, null), /directory is unsafe|busy or unsafe/)
  assert.throws(() => writeCommissioningJournal(settingsPath, journal), /expected/)
  assert.throws(() => writeCommissioningJournal(settingsPath, { ...journal, revision: 2 }, null), /invalid|next CAS/)
  assert.equal(sanitizeCommissioningJournal({ ...journal, rawPath: '/private' }), null)
})

test('reclaims a valid private lock only when its owner is dead', (t) => {
  const settingsPath = temporarySettings(t)
  const { snapshot, plan } = fixture()
  const journal = createCommissioningJournal(snapshot, plan, '2026-09-04T20:01:00.000Z')
  const directory = path.dirname(commissioningJournalPath(settingsPath))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const lockPath = path.join(directory, '.journal.lock')
  writeFileSync(lockPath, `${JSON.stringify({ pid: 2147483647, nonce: '00000000-0000-4000-8000-000000000000' })}\n`, { mode: 0o600 })
  assert.deepEqual(writeCommissioningJournal(settingsPath, journal, null), journal)
})
